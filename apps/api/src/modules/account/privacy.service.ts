import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@resget/database';
import {
  CONSENT_CHANNELS,
  TERMINAL_ORDER_STATUSES,
  anonymizedAddressSnapshot,
  deletedUserPhone,
  orderShortCode,
} from '@resget/shared';
import type { PersonalDataExportDTO } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsRegistry } from '../payments/payments.registry';
import { ACTIVE_TRIP_STATUSES } from '../orders/orders.service';
import { conflict, notFound } from '../../common/api-error';

/** Orders still in motion block a deletion; an unpaid one waiting for payment does not (no money, no kitchen). */
const OPEN_ORDER_EXCLUDED = [...TERMINAL_ORDER_STATUSES, 'PENDING_PAYMENT'] as const;

/**
 * Personal data rights (docs/KISISEL_VERI.md). The export gathers what the
 * platform holds about the signed-in person. Deletion erases what only
 * serves the person (addresses, cards, devices, codes, courier positions,
 * marketing consent, loyalty points, notes and tags at restaurants) and
 * anonymises what the law makes the platform and the restaurants keep
 * (orders, payments, invoices): those rows stay for their retention period
 * without a name, a number or an address. The user row itself stays as an
 * anonymous tombstone so kept records still point somewhere; its phone is
 * freed, so the same number can sign up again as a new person.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsRegistry,
  ) {}

  async exportData(userId: string): Promise<PersonalDataExportDTO> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        phone: true,
        fullName: true,
        email: true,
        locale: true,
        createdAt: true,
        addresses: { orderBy: { createdAt: 'asc' } },
        orders: {
          orderBy: { placedAt: 'desc' },
          select: {
            id: true,
            status: true,
            fulfillment: true,
            placedAt: true,
            chargedToCustomerMinor: true,
            currency: true,
            addressSnapshot: true,
            restaurant: { select: { name: true } },
            items: { orderBy: { position: 'asc' }, select: { nameSnapshot: true, quantity: true } },
            rating: { select: { score: true, comment: true } },
          },
        },
        restaurantCustomers: { include: { restaurant: { select: { name: true } } } },
        memberships: {
          include: { restaurant: { select: { name: true } }, roleTemplate: { select: { name: true } } },
        },
        consents: { orderBy: { acceptedAt: 'asc' }, include: { documentVersion: true } },
        savedPaymentMethods: { select: { brand: true, last4: true, expiryMonth: true, expiryYear: true } },
        pushDevices: { where: { disabledAt: null }, select: { platform: true, lastSeenAt: true } },
      },
    });
    if (!user) throw notFound('NOT_FOUND', 'Account not found');
    const addressOf = (raw: Prisma.JsonValue) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const a = raw as Record<string, unknown>;
      const text = (key: string) => (typeof a[key] === 'string' ? (a[key] as string) : '');
      return { addressLine: text('addressLine'), city: text('city'), district: text('district') };
    };
    return {
      exportedAt: new Date().toISOString(),
      profile: {
        phone: user.phone,
        fullName: user.fullName,
        email: user.email,
        locale: user.locale,
        createdAt: user.createdAt.toISOString(),
      },
      addresses: user.addresses.map((a) => ({
        label: a.label,
        addressLine: a.addressLine,
        city: a.city,
        district: a.district,
        postalCode: a.postalCode,
        note: a.note,
        createdAt: a.createdAt.toISOString(),
      })),
      orders: user.orders.map((o) => ({
        shortCode: orderShortCode(o.id),
        restaurant: o.restaurant.name,
        status: o.status,
        fulfillment: o.fulfillment,
        placedAt: o.placedAt.toISOString(),
        totalMinor: o.chargedToCustomerMinor,
        currency: o.currency,
        items: o.items.map((i) => ({ name: i.nameSnapshot, quantity: i.quantity })),
        address: addressOf(o.addressSnapshot),
        rating: o.rating ? { score: o.rating.score, comment: o.rating.comment } : null,
      })),
      restaurants: user.restaurantCustomers.map((c) => ({
        restaurant: c.restaurant.name,
        orderCount: c.orderCount,
        marketingOptIn: c.marketingOptIn,
        loyaltyPoints: c.loyaltyPoints,
        firstOrderAt: c.firstOrderAt?.toISOString() ?? null,
        lastOrderAt: c.lastOrderAt?.toISOString() ?? null,
      })),
      memberships: user.memberships.map((m) => ({
        restaurant: m.restaurant.name,
        role: m.roleTemplate.name,
        status: m.status,
        joinedAt: m.joinedAt?.toISOString() ?? null,
      })),
      consents: user.consents.map((c) => ({
        document: c.documentVersion.type,
        version: c.documentVersion.version,
        acceptedAt: c.acceptedAt.toISOString(),
      })),
      savedCards: user.savedPaymentMethods,
      devices: user.pushDevices.map((d) => ({ platform: d.platform, lastSeenAt: d.lastSeenAt.toISOString() })),
    };
  }

  async deleteAccount(userId: string, now: Date = new Date()): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        isSuperAdmin: true,
        memberships: { select: { id: true, status: true, roleTemplate: { select: { isOwner: true } } } },
        savedPaymentMethods: { select: { encryptedToken: true } },
      },
    });
    if (!user) throw notFound('NOT_FOUND', 'Account not found');
    if (user.isSuperAdmin)
      throw conflict('ACCOUNT_DELETE_SUPER_ADMIN', 'A platform administrator cannot delete itself');
    if (user.memberships.some((m) => m.status === 'ACTIVE' && m.roleTemplate.isOwner)) {
      throw conflict('ACCOUNT_DELETE_OWNER', 'Owners hand the business over or close it first');
    }
    const membershipIds = user.memberships.map((m) => m.id);
    const [openOrders, activeTrips] = await Promise.all([
      this.prisma.order.count({
        where: { customerUserId: userId, status: { notIn: [...OPEN_ORDER_EXCLUDED] } },
      }),
      membershipIds.length === 0
        ? Promise.resolve(0)
        : this.prisma.deliveryTrip.count({
            where: { courierMembershipId: { in: membershipIds }, status: { in: [...ACTIVE_TRIP_STATUSES] } },
          }),
    ]);
    if (openOrders > 0) throw conflict('ACCOUNT_DELETE_ACTIVE_ORDERS', 'An order of this account is still open');
    if (activeTrips > 0) throw conflict('ACCOUNT_DELETE_ACTIVE_TRIP', 'A delivery trip of this account is active');

    await this.prisma.$transaction(async (tx) => {
      await tx.customerAddress.deleteMany({ where: { userId } });
      await tx.pushDevice.deleteMany({ where: { userId } });
      // Every signed-in app and browser ends with the account (docs/GUVENLIK.md "Oturumlar").
      await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      await tx.sessionHandoff.deleteMany({ where: { userId } });
      await tx.otpCode.deleteMany({ where: { userId } });
      await tx.savedPaymentMethod.deleteMany({ where: { userId } });
      if (membershipIds.length > 0) {
        await tx.courierLocationSample.deleteMany({ where: { membershipId: { in: membershipIds } } });
        await tx.courierLocation.deleteMany({ where: { membershipId: { in: membershipIds } } });
        await tx.membership.updateMany({ where: { userId }, data: { status: 'PASSIVE' } });
      }

      // At each restaurant: no more marketing, notes, tags or points; the counters stay for the restaurant's figures.
      const customers = await tx.restaurantCustomer.findMany({
        where: { userId },
        select: { id: true, restaurantId: true, loyaltyPoints: true },
      });
      for (const customer of customers) {
        if (customer.loyaltyPoints !== 0) {
          await tx.loyaltyTransaction.create({
            data: {
              restaurantId: customer.restaurantId,
              customerId: customer.id,
              type: 'ADJUSTMENT',
              points: -customer.loyaltyPoints,
              balanceAfter: 0,
              memo: 'account deleted',
            },
          });
        }
      }
      // Every channel is refused, so no rule can reach the anonymised contact again (docs/RIZA.md).
      const contacts = await tx.restaurantCustomer.findMany({
        where: { userId },
        select: { id: true, restaurantId: true },
      });
      if (contacts.length > 0) {
        await tx.contactConsent.createMany({
          data: contacts.flatMap((c) =>
            CONSENT_CHANNELS.map((channel) => ({
              restaurantId: c.restaurantId,
              customerId: c.id,
              channel,
              granted: false,
              source: 'ACCOUNT_DELETED',
              createdAt: now,
            })),
          ),
        });
      }
      await tx.restaurantCustomer.updateMany({
        where: { userId },
        data: {
          consentChannels: [],
          isBusiness: false,
          marketingOptIn: false,
          marketingOptOutAt: now,
          marketingToken: null,
          note: null,
          tags: [],
          loyaltyPoints: 0,
        },
      });
      // A deleted account shares no code and keeps no reward (docs/TAVSIYE.md); used coupons stay for the books.
      await tx.coupon.updateMany({
        where: { OR: [{ referrer: { userId } }, { owner: { userId } }] },
        data: { isActive: false },
      });

      // Kept orders lose what identifies the person; the area stays for reports.
      const orders = await tx.order.findMany({
        where: { customerUserId: userId },
        select: { id: true, addressSnapshot: true },
      });
      for (const order of orders) {
        const anonymous = anonymizedAddressSnapshot(order.addressSnapshot);
        await tx.order.update({
          where: { id: order.id },
          data: {
            customerNote: null,
            addressSnapshot: anonymous ? (anonymous as Prisma.InputJsonValue) : Prisma.JsonNull,
          },
        });
      }
      await tx.orderRating.updateMany({ where: { order: { customerUserId: userId } }, data: { comment: null } });
      // Copies of the words in feedback cases and NPS answers go too (docs/GERI_BILDIRIM.md); the scores stay.
      await tx.feedbackCase.updateMany({ where: { order: { customerUserId: userId } }, data: { comment: null } });
      await tx.npsResponse.updateMany({ where: { order: { customerUserId: userId } }, data: { comment: null } });

      await tx.user.update({
        where: { id: userId },
        data: { phone: deletedUserPhone(userId), fullName: '', email: null, locale: null, deletedAt: now },
      });
      await tx.auditLog.create({
        data: { actorUserId: userId, action: 'account.deleted', entity: 'User', entityId: userId },
      });
    });

    // The vault forgets the cards after the commit; a failure there leaves nothing on the platform to point at them.
    for (const card of user.savedPaymentMethods) {
      try {
        await this.payments.vault.forget(this.payments.cipher.decrypt(card.encryptedToken));
      } catch (error) {
        this.logger.warn(`Vault did not forget a card of a deleted account: ${(error as Error).message}`);
      }
    }
  }
}
