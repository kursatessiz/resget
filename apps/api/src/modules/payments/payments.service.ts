import { Injectable, Logger } from '@nestjs/common';
import { PaymentConnectionStatus, PaymentMode } from '@resget/database';
import { applyCommissionCredits, buildCommissionStatement, commissionPeriod } from '@resget/shared';
import type {
  CommissionStatement,
  ConnectOwnPosInput,
  PaymentSettingsDTO,
  SavedPaymentMethodDTO,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsRegistry } from './payments.registry';
import { tokenFingerprint } from '../../common/crypto/credential-cipher';
import { forbidden, notFound } from '../../common/api-error';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PaymentsRegistry,
  ) {}

  async settings(restaurantId: string): Promise<PaymentSettingsDTO> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: {
        paymentMode: true,
        currency: true,
        paymentConnection: { select: { providerCode: true, status: true, label: true, lastVerifiedAt: true } },
      },
    });
    if (!restaurant) throw notFound('NOT_FOUND', 'Restaurant not found');
    const now = new Date();
    // What this month's invoice would be today: charges net of the credits it would absorb.
    const accrued = await this.commissionStatement(restaurantId, now.getUTCFullYear(), now.getUTCMonth() + 1);
    const c = restaurant.paymentConnection;
    return {
      paymentMode: restaurant.paymentMode,
      connection: c
        ? {
            providerCode: c.providerCode,
            status: c.status,
            label: c.label,
            lastVerifiedAt: c.lastVerifiedAt?.toISOString() ?? null,
          }
        : null,
      accruedCommissionMinor: accrued.totalMinor,
      currency: restaurant.currency,
    };
  }

  /**
   * Stores the restaurant's own POS credentials encrypted and verifies them
   * with the provider. The plaintext never leaves this method and is never
   * logged; the API returns only the masked label.
   */
  async connectOwnPos(restaurantId: string, input: ConnectOwnPosInput): Promise<PaymentSettingsDTO> {
    const gateway = this.registry.gateway(input.providerCode);
    if (!gateway) throw forbidden('VALIDATION', `No adapter for ${input.providerCode}`);
    const verification = await gateway.verifyCredentials(input.credentials);
    const encryptedCredentials = this.registry.cipher.encryptJson(input.credentials);
    await this.prisma.paymentProviderConnection.upsert({
      where: { restaurantId },
      create: {
        restaurantId,
        providerCode: input.providerCode,
        encryptedCredentials,
        keyVersion: this.registry.cipher.keyVersion,
        status: verification.ok ? PaymentConnectionStatus.ACTIVE : PaymentConnectionStatus.FAILED,
        label: verification.ok ? verification.label : `${input.providerCode}`,
        lastVerifiedAt: verification.ok ? new Date() : null,
        failureReason: verification.ok ? null : (verification.reason ?? 'verification failed'),
      },
      update: {
        providerCode: input.providerCode,
        encryptedCredentials,
        keyVersion: this.registry.cipher.keyVersion,
        status: verification.ok ? PaymentConnectionStatus.ACTIVE : PaymentConnectionStatus.FAILED,
        label: verification.ok ? verification.label : `${input.providerCode}`,
        lastVerifiedAt: verification.ok ? new Date() : null,
        failureReason: verification.ok ? null : (verification.reason ?? 'verification failed'),
      },
    });
    if (!verification.ok)
      this.logger.warn(`POS verification failed for restaurant ${restaurantId} (${input.providerCode})`);
    return this.settings(restaurantId);
  }

  async disconnectOwnPos(restaurantId: string): Promise<PaymentSettingsDTO> {
    await this.prisma.paymentProviderConnection.updateMany({
      where: { restaurantId },
      data: { status: PaymentConnectionStatus.DISABLED },
    });
    return this.settings(restaurantId);
  }

  /** OWN_POS needs an active connection; PLATFORM_PSP needs the platform's PSP configured (env). */
  async setPaymentMode(restaurantId: string, mode: PaymentMode): Promise<PaymentSettingsDTO> {
    if (mode === PaymentMode.OWN_POS) {
      const connection = await this.prisma.paymentProviderConnection.findUnique({
        where: { restaurantId },
        select: { status: true },
      });
      if (connection?.status !== PaymentConnectionStatus.ACTIVE)
        throw forbidden('PAYMENT_CONNECTION_REQUIRED', 'Connect an active POS first');
    }
    await this.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: mode } });
    return this.settings(restaurantId);
  }

  /**
   * The commission a restaurant owes for a month (docs/FATURALAMA.md). No
   * commission is taken on a refunded or charged-back order (docs/MUTABAKAT.md,
   * "İade ve chargeback"): such an order is left out while the month is open,
   * and one billed on an earlier invoice is credited on the next one. Once
   * the month's invoice exists, the statement shows exactly what it billed
   * and credited.
   */
  async commissionStatement(restaurantId: string, year: number, month: number): Promise<CommissionStatement> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { currency: true },
    });
    if (!restaurant) throw notFound('NOT_FOUND', 'Restaurant not found');
    const period = commissionPeriod(year, month);
    const invoice = await this.prisma.commissionInvoice.findUnique({
      where: { restaurantId_periodStart: { restaurantId, periodStart: period.periodStart } },
      select: { id: true },
    });
    const select = {
      id: true,
      platformCommissionMinor: true,
      commissionVatMinor: true,
      itemsGrossMinor: true,
      discountMinor: true,
      discountFundedBy: true,
    } as const;
    const toLine = (o: {
      id: string;
      platformCommissionMinor: number;
      commissionVatMinor: number;
      itemsGrossMinor: number;
      discountMinor: number;
      discountFundedBy: string | null;
    }) => ({
      orderId: o.id,
      baseMinor: o.itemsGrossMinor - (o.discountFundedBy === 'RESTAURANT' ? o.discountMinor : 0),
      commissionMinor: o.platformCommissionMinor,
      commissionVatMinor: o.commissionVatMinor,
    });

    // One credit line per refund: the share of the order's commission it gave back (docs/MUTABAKAT.md, "Kısmi iade").
    const refundSelect = { id: true, orderId: true, commissionMinor: true, commissionVatMinor: true } as const;
    const toCredit = (r: { id: string; orderId: string; commissionMinor: number; commissionVatMinor: number }) => ({
      orderId: r.orderId,
      refundId: r.id,
      baseMinor: 0,
      commissionMinor: r.commissionMinor,
      commissionVatMinor: r.commissionVatMinor,
    });

    if (invoice) {
      const [billed, credited] = await Promise.all([
        this.prisma.order.findMany({
          where: { restaurantId, commissionInvoiceId: invoice.id },
          select,
          orderBy: { completedAt: 'asc' },
        }),
        this.prisma.orderRefund.findMany({
          where: { restaurantId, creditInvoiceId: invoice.id },
          select: refundSelect,
          orderBy: { createdAt: 'asc' },
        }),
      ]);
      return buildCommissionStatement(restaurant.currency, period, billed.map(toLine), credited.map(toCredit));
    }

    const charges = await this.prisma.order.findMany({
      where: {
        restaurantId,
        paymentMode: PaymentMode.OWN_POS,
        status: { in: ['DELIVERED', 'PICKED_UP'] },
        completedAt: { gte: period.periodStart, lt: period.periodEnd },
        commissionInvoiceId: null,
        // Fully refunded or charged back before any invoice: no commission at all, and no credit either.
        commissionReversedAt: null,
      },
      select,
      orderBy: { completedAt: 'asc' },
    });
    // Refunds give their share back only for an order that is billed: on an earlier invoice or on this one.
    const pending = await this.prisma.orderRefund.findMany({
      where: {
        restaurantId,
        creditInvoiceId: null,
        OR: [{ commissionMinor: { gt: 0 } }, { commissionVatMinor: { gt: 0 } }],
        order: { paymentMode: PaymentMode.OWN_POS },
        AND: [
          {
            OR: [{ order: { commissionInvoiceId: { not: null } } }, { orderId: { in: charges.map((o) => o.id) } }],
          },
        ],
      },
      select: refundSelect,
      orderBy: { createdAt: 'asc' },
    });
    const chargeLines = charges.map(toLine);
    const { applied } = applyCommissionCredits(chargeLines, pending.map(toCredit));
    return buildCommissionStatement(restaurant.currency, period, chargeLines, applied);
  }

  // -- Customer cards -----------------------------------------------------------

  async listSavedCards(userId: string): Promise<SavedPaymentMethodDTO[]> {
    const rows = await this.prisma.savedPaymentMethod.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider as SavedPaymentMethodDTO['provider'],
      brand: r.brand,
      last4: r.last4,
      expiryMonth: r.expiryMonth,
      expiryYear: r.expiryYear,
      label: r.label,
      isDefault: r.isDefault,
    }));
  }

  async beginCardLink(
    userId: string,
    returnUrl: string,
  ): Promise<{ redirectUrl: string | null; clientParams: Record<string, string> }> {
    return this.registry.vault.beginLink(userId, returnUrl);
  }

  /** Stores the vault's tokens for the user; the token itself is encrypted, its fingerprint keeps the row unique. */
  async completeCardLink(userId: string, callbackPayload: Record<string, string>): Promise<SavedPaymentMethodDTO[]> {
    const cards = await this.registry.vault.completeLink(userId, callbackPayload);
    const existingCount = await this.prisma.savedPaymentMethod.count({ where: { userId } });
    for (const [index, card] of cards.entries()) {
      const tokenHash = tokenFingerprint(card.token);
      await this.prisma.savedPaymentMethod.upsert({
        where: { userId_provider_tokenHash: { userId, provider: this.registry.vault.code, tokenHash } },
        create: {
          userId,
          provider: this.registry.vault.code,
          encryptedToken: this.registry.cipher.encrypt(card.token),
          keyVersion: this.registry.cipher.keyVersion,
          tokenHash,
          brand: card.brand,
          last4: card.last4,
          expiryMonth: card.expiryMonth,
          expiryYear: card.expiryYear,
          label: card.label ?? null,
          isDefault: existingCount === 0 && index === 0,
        },
        update: { brand: card.brand, last4: card.last4, expiryMonth: card.expiryMonth, expiryYear: card.expiryYear },
      });
    }
    return this.listSavedCards(userId);
  }

  async removeSavedCard(userId: string, id: string): Promise<void> {
    const row = await this.prisma.savedPaymentMethod.findFirst({ where: { id, userId } });
    if (!row) throw notFound('NOT_FOUND', 'Card not found');
    await this.registry.vault.forget(this.registry.cipher.decrypt(row.encryptedToken)).catch(() => undefined);
    await this.prisma.savedPaymentMethod.delete({ where: { id } });
  }
}
