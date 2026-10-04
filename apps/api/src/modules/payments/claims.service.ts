import { Injectable } from '@nestjs/common';
import {
  approvedClaimItems,
  canFileClaim,
  itemsRefundMinor,
  refundableMinor,
  refundedQuantities,
} from '@resget/shared';
import type {
  ApproveClaimInput,
  DeclineClaimInput,
  FileClaimInput,
  OrderDetailDTO,
  OrderTrackingDTO,
  RefundItem,
} from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { OrdersService } from '../orders/orders.service';
import { OrderNotificationsService } from '../orders/order-notifications.service';
import { RefundsService } from './refunds.service';
import { conflict, notFound } from '../../common/api-error';

/**
 * Missing-item claims (docs/ODEME.md, "Eksik ürün bildirimi"). The customer
 * reports from the tracking page (the tracking token is the credential,
 * like the rating); the restaurant's staff with `orders.refund` approve all
 * or part of it, which pays it out as a partial refund of those items
 * (source CLAIM, so the restaurant bears it and the platform gives back the
 * refunded share of its commission), or decline it with a reason the
 * customer reads. One claim waits at a time per order.
 */
@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly refunds: RefundsService,
    private readonly notifications: OrderNotificationsService,
    private readonly realtime: RealtimeService,
    private readonly features: FeatureFlagsService,
  ) {}

  async fileByToken(token: string, input: FileClaimInput): Promise<OrderTrackingDTO> {
    const order = await this.prisma.order.findUnique({
      where: { trackingToken: token },
      select: {
        id: true,
        restaurantId: true,
        status: true,
        completedAt: true,
        itemsGrossMinor: true,
        discountMinor: true,
        items: { select: { id: true, quantity: true, lineTotalMinor: true } },
        payments: { select: { status: true, amountMinor: true, refundedMinor: true } },
        refunds: { select: { items: true } },
        claims: { where: { status: 'OPEN' }, select: { id: true } },
      },
    });
    if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    await this.features.assertEnabled('missing_item_claims', order.restaurantId);
    const left = order.payments.reduce((n, p) => n + refundableMinor(p), 0);
    if (!canFileClaim(order, order.claims.length > 0, left)) {
      throw conflict('CLAIM_NOT_ALLOWED', 'A missing item cannot be reported for this order now');
    }
    const given = refundedQuantities(
      order.refunds.map((r) => ({ items: Array.isArray(r.items) ? (r.items as unknown as RefundItem[]) : null })),
    );
    const requestedMinor = itemsRefundMinor(order, order.items, input.items, given);
    if (requestedMinor === null || requestedMinor === 0) {
      throw conflict('CLAIM_ITEMS_INVALID', 'Items cannot be claimed');
    }
    // One waiting claim per order: the check and the insert run in one serialisable step per order row.
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "orders" WHERE "id" = ${order.id} FOR UPDATE`;
      const open = await tx.orderClaim.count({ where: { orderId: order.id, status: 'OPEN' } });
      if (open > 0) throw conflict('CLAIM_NOT_ALLOWED', 'A report is already waiting');
      await tx.orderClaim.create({
        data: {
          restaurantId: order.restaurantId,
          orderId: order.id,
          items: input.items,
          requestedMinor,
          note: input.note ?? null,
        },
      });
    });
    this.realtime.publishMany(await this.orders.eventsForOrder(order.id));
    await this.notifications.alertStaffOfClaim(order.id);
    return this.orders.trackingByToken(token);
  }

  /** Pays the claim out as a partial refund of the approved items; the claim stays open if no money went back. */
  async approve(
    restaurantId: string,
    orderId: string,
    claimId: string,
    input: ApproveClaimInput,
    actorUserId: string,
    canSeeContacts: boolean,
  ): Promise<OrderDetailDTO> {
    const claim = await this.openClaim(restaurantId, orderId, claimId);
    const items = approvedClaimItems(claim.items as unknown as RefundItem[], input.items);
    if (!items) throw conflict('CLAIM_ITEMS_INVALID', 'Approve at most what was claimed');
    // Taken first, so two screens cannot pay the same claim twice.
    const taken = await this.prisma.orderClaim.updateMany({
      where: { id: claim.id, status: 'OPEN' },
      data: { status: 'APPROVED', decidedByUserId: actorUserId, decidedAt: new Date() },
    });
    if (taken.count === 0) throw conflict('CLAIM_NOT_OPEN', 'Claim already decided');
    try {
      await this.refunds.refundPart(
        restaurantId,
        orderId,
        { reason: claim.note ?? '', items },
        actorUserId,
        'CLAIM',
        claim.id,
      );
    } catch (error) {
      // Nothing went back: the claim waits again. Part of it went back (a later payment failed): it stays approved.
      const paid = await this.prisma.orderRefund.count({ where: { claimId: claim.id } });
      if (paid === 0) {
        await this.prisma.orderClaim.update({
          where: { id: claim.id },
          data: { status: 'OPEN', decidedByUserId: null, decidedAt: null },
        });
        this.realtime.publishMany(await this.orders.eventsForOrder(orderId));
      }
      throw error;
    }
    return this.orders.detail(restaurantId, orderId, canSeeContacts);
  }

  async decline(
    restaurantId: string,
    orderId: string,
    claimId: string,
    input: DeclineClaimInput,
    actorUserId: string,
    canSeeContacts: boolean,
  ): Promise<OrderDetailDTO> {
    const claim = await this.openClaim(restaurantId, orderId, claimId);
    const taken = await this.prisma.orderClaim.updateMany({
      where: { id: claim.id, status: 'OPEN' },
      data: { status: 'DECLINED', declineReason: input.reason, decidedByUserId: actorUserId, decidedAt: new Date() },
    });
    if (taken.count === 0) throw conflict('CLAIM_NOT_OPEN', 'Claim already decided');
    this.realtime.publishMany(await this.orders.eventsForOrder(orderId));
    await this.notifications.notifyClaimDeclined(orderId, input.reason);
    return this.orders.detail(restaurantId, orderId, canSeeContacts);
  }

  private async openClaim(restaurantId: string, orderId: string, claimId: string) {
    const claim = await this.prisma.orderClaim.findFirst({
      where: { id: claimId, orderId, restaurantId },
      select: { id: true, status: true, items: true, note: true },
    });
    if (!claim) throw notFound('CLAIM_NOT_FOUND', 'Claim not found');
    if (claim.status !== 'OPEN') throw conflict('CLAIM_NOT_OPEN', 'Claim already decided');
    return claim;
  }
}
