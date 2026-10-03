import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommissionInvoiceStatus, Prisma } from '@resget/database';
import {
  COMMISSION_INVOICE_DUE_DAYS,
  MAX_COLLECTION_ATTEMPTS,
  collectionIsDue,
  commissionDueAt,
  commissionPeriod,
  formatMoney,
  invoiceIsOpen,
  previousCommissionPeriod,
} from '@resget/shared';
import type {
  AdminInvoiceDTO,
  AdminInvoicePageDTO,
  AdminInvoiceQuery,
  BillingOverviewDTO,
  BillingRunReportDTO,
  CardVaultProviderCode,
  CommissionInvoiceDTO,
  InvoiceProviderAdapter,
  MessageTemplateKey,
  PayInvoiceInput,
  PayInvoiceResultDTO,
  SavedPaymentMethodDTO,
  VaultChargeResult,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentsRegistry } from '../payments/payments.registry';
import { MessagingService } from '../messaging/messaging.service';
import { badRequest, conflict, notFound } from '../../common/api-error';
import { INVOICE_PROVIDER } from './invoice-provider';

const invoiceSelect = Prisma.validator<Prisma.CommissionInvoiceSelect>()({
  id: true,
  restaurantId: true,
  periodStart: true,
  periodEnd: true,
  currency: true,
  orderCount: true,
  baseMinor: true,
  commissionMinor: true,
  vatMinor: true,
  totalMinor: true,
  status: true,
  issuedAt: true,
  dueAt: true,
  paidAt: true,
  paymentRef: true,
  fiscalRef: true,
  fiscalDocumentUrl: true,
  collectionAttempts: true,
  lastCollectionAt: true,
  lastCollectionError: true,
  restaurant: { select: { id: true, name: true, slug: true } },
});
type InvoiceRow = Prisma.CommissionInvoiceGetPayload<{ select: typeof invoiceSelect }>;

const cardSelect = Prisma.validator<Prisma.SavedPaymentMethodSelect>()({
  id: true,
  provider: true,
  brand: true,
  last4: true,
  expiryMonth: true,
  expiryYear: true,
  label: true,
  isDefault: true,
  encryptedToken: true,
});
type CardRow = Prisma.SavedPaymentMethodGetPayload<{ select: typeof cardSelect }>;

/**
 * Commission billing (docs/FATURALAMA.md): the daily job cuts the previous
 * month into one invoice per restaurant from the per-order snapshots, has the
 * fiscal document issued, collects from the restaurant's billing card through
 * the card vault, and ages unpaid invoices into OVERDUE, which pauses the
 * marketplace listing until the invoice is settled. Every step is idempotent:
 * an invoice per restaurant and period, a fiscal number per invoice, a charge
 * attempt only when the previous one is old enough.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly registry: PaymentsRegistry,
    private readonly messaging: MessagingService,
    private readonly config: ConfigService,
    @Inject(INVOICE_PROVIDER) private readonly fiscal: InvoiceProviderAdapter,
  ) {}

  // -- The daily job -----------------------------------------------------------------------

  async runDaily(asOf: Date = new Date()): Promise<BillingRunReportDTO> {
    const { year, month } = previousCommissionPeriod(asOf);
    const period = commissionPeriod(year, month);
    const issue = await this.issuePeriod(year, month, asOf);
    const fiscalized = await this.fiscalizePending();
    const collect = await this.collectDue(asOf);
    const aged = await this.markOverdue(asOf);
    const report: BillingRunReportDTO = {
      asOf: asOf.toISOString(),
      periodStart: period.periodStart.toISOString(),
      periodEnd: period.periodEnd.toISOString(),
      ...issue,
      fiscalized,
      ...collect,
      ...aged,
    };
    // The console's system page shows when the job last ran from this line.
    await this.prisma.auditLog.create({
      data: { action: 'billing.run', entity: 'billing', entityId: report.periodStart, meta: { ...report } },
    });
    return report;
  }

  /** One invoice per active restaurant that owes commission for the month; nothing for a month without commission. */
  private async issuePeriod(year: number, month: number, now: Date): Promise<{ issued: number; skipped: number }> {
    const period = commissionPeriod(year, month);
    const restaurants = await this.prisma.restaurant.findMany({
      where: { isActive: true, commissionInvoices: { none: { periodStart: period.periodStart } } },
      select: { id: true, defaultLocale: true },
    });
    let issued = 0;
    let skipped = 0;
    for (const restaurant of restaurants) {
      const statement = await this.payments.commissionStatement(restaurant.id, year, month);
      if (statement.orderCount === 0 || statement.totalMinor <= 0) {
        skipped += 1;
        continue;
      }
      const memo = `commission ${year}-${String(month).padStart(2, '0')}`;
      let row: InvoiceRow;
      try {
        row = await this.prisma.$transaction(async (tx) => {
          const created = await tx.commissionInvoice.create({
            data: {
              restaurantId: restaurant.id,
              periodStart: period.periodStart,
              periodEnd: period.periodEnd,
              currency: statement.currency,
              orderCount: statement.orderCount,
              baseMinor: statement.baseMinor,
              commissionMinor: statement.commissionMinor,
              vatMinor: statement.vatMinor,
              totalMinor: statement.totalMinor,
              status: CommissionInvoiceStatus.ISSUED,
              issuedAt: now,
              dueAt: commissionDueAt(now),
            },
            select: invoiceSelect,
          });
          // Signed from the restaurant's point of view: what it owes the platform for the month.
          await tx.ledgerEntry.createMany({
            data: [
              {
                restaurantId: restaurant.id,
                invoiceId: created.id,
                type: 'PLATFORM_COMMISSION',
                amountMinor: -statement.commissionMinor,
                currency: statement.currency,
                occurredAt: now,
                memo,
              },
              {
                restaurantId: restaurant.id,
                invoiceId: created.id,
                type: 'COMMISSION_VAT',
                amountMinor: -statement.vatMinor,
                currency: statement.currency,
                occurredAt: now,
                memo,
              },
            ],
          });
          return created;
        });
      } catch (error) {
        // A parallel run already wrote this period: the unique index is the guard, not a lock.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
        throw error;
      }
      issued += 1;
      await this.notifyOwner(row, 'invoice.issued');
    }
    return { issued, skipped };
  }

  /** Fiscal documents for invoices that have none yet; a failed integrator call is retried on the next run. */
  private async fiscalizePending(): Promise<number> {
    const pending = await this.prisma.commissionInvoice.findMany({
      where: { fiscalRef: null, status: { in: ['ISSUED', 'OVERDUE', 'PAID'] } },
      select: {
        ...invoiceSelect,
        restaurant: { select: { id: true, name: true, slug: true, legalName: true, taxId: true, countryCode: true } },
      },
      take: 200,
    });
    let count = 0;
    for (const invoice of pending) {
      try {
        const result = await this.fiscal.issue({
          invoiceId: invoice.id,
          restaurant: {
            name: invoice.restaurant.name,
            legalName: invoice.restaurant.legalName,
            taxId: invoice.restaurant.taxId,
            countryCode: invoice.restaurant.countryCode,
          },
          currency: invoice.currency,
          periodStart: invoice.periodStart,
          periodEnd: invoice.periodEnd,
          orderCount: invoice.orderCount,
          baseMinor: invoice.baseMinor,
          commissionMinor: invoice.commissionMinor,
          vatMinor: invoice.vatMinor,
          totalMinor: invoice.totalMinor,
        });
        await this.prisma.commissionInvoice.update({
          where: { id: invoice.id },
          data: { fiscalRef: result.ref, fiscalDocumentUrl: result.documentUrl },
        });
        count += 1;
      } catch (error) {
        this.logger.warn(
          `fiscal document for invoice ${invoice.id} failed: ${error instanceof Error ? error.message : 'error'}`,
        );
      }
    }
    return count;
  }

  /** Charges every open invoice whose restaurant has a billing card and whose previous attempt is old enough. */
  private async collectDue(now: Date): Promise<{ collected: number; collectionFailed: number }> {
    const candidates = await this.prisma.commissionInvoice.findMany({
      where: {
        status: { in: ['ISSUED', 'OVERDUE'] },
        collectionAttempts: { lt: MAX_COLLECTION_ATTEMPTS },
        restaurant: { billingPaymentMethodId: { not: null } },
      },
      select: {
        ...invoiceSelect,
        restaurant: { select: { id: true, name: true, slug: true, billingPaymentMethod: { select: cardSelect } } },
      },
    });
    let collected = 0;
    let collectionFailed = 0;
    for (const invoice of candidates) {
      const card = invoice.restaurant.billingPaymentMethod;
      if (!card || !collectionIsDue(invoice, now)) continue;
      const result = await this.charge(invoice, card, now, `${this.appUrl()}/panel/${invoice.restaurant.slug}/finans`);
      if (result.status === 'CAPTURED') collected += 1;
      else collectionFailed += 1;
    }
    return { collected, collectionFailed };
  }

  /** Issued invoices past their due moment become OVERDUE and pause the restaurant's marketplace listing. */
  private async markOverdue(now: Date): Promise<{ overdue: number; suspended: number }> {
    const due = await this.prisma.commissionInvoice.findMany({
      where: { status: CommissionInvoiceStatus.ISSUED, dueAt: { lt: now } },
      select: invoiceSelect,
    });
    if (due.length === 0) return { overdue: 0, suspended: 0 };
    await this.prisma.commissionInvoice.updateMany({
      where: { id: { in: due.map((i) => i.id) } },
      data: { status: CommissionInvoiceStatus.OVERDUE },
    });
    let suspended = 0;
    const seen = new Set<string>();
    for (const invoice of due) {
      if (seen.has(invoice.restaurantId)) continue;
      seen.add(invoice.restaurantId);
      const paused = await this.prisma.restaurant.updateMany({
        where: { id: invoice.restaurantId, listingSuspendedAt: null },
        data: { listingSuspendedAt: now },
      });
      if (paused.count === 1) {
        suspended += 1;
        await this.audit(null, invoice.restaurantId, 'restaurant.listing_suspended', 'commission_invoice', invoice.id, {
          dueAt: invoice.dueAt?.toISOString() ?? null,
        });
        await this.notifyOwner({ ...invoice, status: 'OVERDUE' }, 'invoice.overdue');
      }
    }
    return { overdue: due.length, suspended };
  }

  // -- Restaurant panel ----------------------------------------------------------------------

  async overview(restaurantId: string): Promise<BillingOverviewDTO> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { currency: true, listingSuspendedAt: true, billingPaymentMethod: { select: cardSelect } },
    });
    if (!restaurant) throw notFound('RESTAURANT_NOT_FOUND', 'Restaurant not found');
    const invoices = await this.prisma.commissionInvoice.findMany({
      where: { restaurantId },
      orderBy: { periodStart: 'desc' },
      take: 36,
      select: invoiceSelect,
    });
    return {
      currency: restaurant.currency,
      invoices: invoices.map((i) => this.toDto(i)),
      billingCard: restaurant.billingPaymentMethod ? toCardDto(restaurant.billingPaymentMethod) : null,
      listingSuspendedAt: restaurant.listingSuspendedAt?.toISOString() ?? null,
      openTotalMinor: invoices.filter((i) => invoiceIsOpen(i.status)).reduce((n, i) => n + i.totalMinor, 0),
      dueDays: COMMISSION_INVOICE_DUE_DAYS,
    };
  }

  /** The card the platform charges for invoices; only a card of the caller can be designated. */
  async setBillingCard(
    restaurantId: string,
    userId: string,
    paymentMethodId: string | null,
  ): Promise<BillingOverviewDTO> {
    if (paymentMethodId) {
      const card = await this.prisma.savedPaymentMethod.findFirst({
        where: { id: paymentMethodId, userId },
        select: { id: true },
      });
      if (!card) throw notFound('PAYMENT_METHOD_NOT_FOUND', 'Saved card not found');
    }
    await this.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { billingPaymentMethodId: paymentMethodId },
    });
    return this.overview(restaurantId);
  }

  /** Pays an open invoice now, with one of the caller's cards or the billing card. */
  async pay(
    restaurantId: string,
    userId: string,
    invoiceId: string,
    input: PayInvoiceInput,
  ): Promise<PayInvoiceResultDTO> {
    const invoice = await this.prisma.commissionInvoice.findFirst({
      where: { id: invoiceId, restaurantId },
      select: {
        ...invoiceSelect,
        restaurant: { select: { id: true, name: true, slug: true, billingPaymentMethod: { select: cardSelect } } },
      },
    });
    if (!invoice) throw notFound('INVOICE_NOT_FOUND', 'Invoice not found');
    if (!invoiceIsOpen(invoice.status)) throw conflict('INVOICE_STATE_INVALID', 'Invoice is not open');
    const card = input.paymentMethodId
      ? await this.prisma.savedPaymentMethod.findFirst({
          where: { id: input.paymentMethodId, userId },
          select: cardSelect,
        })
      : invoice.restaurant.billingPaymentMethod;
    if (!card) {
      if (input.paymentMethodId) throw notFound('PAYMENT_METHOD_NOT_FOUND', 'Saved card not found');
      throw badRequest('BILLING_CARD_REQUIRED', 'No card to charge');
    }
    const result = await this.charge(invoice, card, new Date(), input.returnUrl);
    return {
      status: result.status,
      redirectUrl: result.redirectUrl,
      failureCode: result.failureCode,
      invoice: await this.get(invoiceId),
    };
  }

  // -- Platform console ----------------------------------------------------------------------

  async list(query: AdminInvoiceQuery): Promise<AdminInvoicePageDTO> {
    const where: Prisma.CommissionInvoiceWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.restaurantId ? { restaurantId: query.restaurantId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.commissionInvoice.findMany({
        where,
        orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: invoiceSelect,
      }),
      this.prisma.commissionInvoice.count({ where }),
    ]);
    return { items: rows.map((r) => this.toAdminDto(r)), total, page: query.page, pageSize: query.pageSize };
  }

  /** A bank transfer arrived: the invoice is settled by hand with the receipt as the reference. */
  async markPaid(actorUserId: string, invoiceId: string, paymentRef: string): Promise<AdminInvoiceDTO> {
    const invoice = await this.requireInvoice(invoiceId);
    if (!invoiceIsOpen(invoice.status)) throw conflict('INVOICE_STATE_INVALID', 'Invoice is not open');
    await this.settle(invoice, `transfer:${paymentRef}`, null, new Date());
    await this.audit(actorUserId, invoice.restaurantId, 'invoice.marked_paid', 'commission_invoice', invoice.id, {
      paymentRef,
    });
    return this.toAdminDto(await this.requireInvoice(invoiceId));
  }

  /** Voids an unpaid invoice: reverses its ledger lines, cancels the fiscal document, lifts a suspension it caused. */
  async voidInvoice(actorUserId: string, invoiceId: string): Promise<AdminInvoiceDTO> {
    const invoice = await this.requireInvoice(invoiceId);
    if (invoice.status === 'PAID' || invoice.status === 'VOID') {
      throw conflict('INVOICE_STATE_INVALID', 'Invoice cannot be voided');
    }
    const now = new Date();
    const memo = `void ${invoice.id}`;
    await this.prisma.$transaction([
      this.prisma.commissionInvoice.update({
        where: { id: invoice.id },
        data: { status: CommissionInvoiceStatus.VOID },
      }),
      this.prisma.ledgerEntry.createMany({
        data: [
          {
            restaurantId: invoice.restaurantId,
            invoiceId: invoice.id,
            type: 'ADJUSTMENT',
            amountMinor: invoice.commissionMinor + invoice.vatMinor,
            currency: invoice.currency,
            occurredAt: now,
            memo,
          },
        ],
      }),
    ]);
    if (invoice.fiscalRef) {
      await this.fiscal
        .cancel(invoice.fiscalRef)
        .catch((error: unknown) =>
          this.logger.warn(
            `fiscal cancel of ${invoice.fiscalRef} failed: ${error instanceof Error ? error.message : 'error'}`,
          ),
        );
    }
    await this.reinstateIfClear(invoice.restaurantId, actorUserId);
    await this.audit(actorUserId, invoice.restaurantId, 'invoice.voided', 'commission_invoice', invoice.id, {});
    return this.toAdminDto(await this.requireInvoice(invoiceId));
  }

  /** One more charge of the restaurant's billing card, outside the daily cadence. */
  async collectNow(actorUserId: string, invoiceId: string): Promise<PayInvoiceResultDTO> {
    const invoice = await this.prisma.commissionInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        ...invoiceSelect,
        restaurant: { select: { id: true, name: true, slug: true, billingPaymentMethod: { select: cardSelect } } },
      },
    });
    if (!invoice) throw notFound('INVOICE_NOT_FOUND', 'Invoice not found');
    if (!invoiceIsOpen(invoice.status)) throw conflict('INVOICE_STATE_INVALID', 'Invoice is not open');
    const card = invoice.restaurant.billingPaymentMethod;
    if (!card) throw badRequest('BILLING_CARD_REQUIRED', 'Restaurant has no billing card');
    const result = await this.charge(
      invoice,
      card,
      new Date(),
      `${this.appUrl()}/panel/${invoice.restaurant.slug}/finans`,
    );
    await this.audit(
      actorUserId,
      invoice.restaurantId,
      'invoice.collection_attempted',
      'commission_invoice',
      invoice.id,
      {
        status: result.status,
        failureCode: result.failureCode,
      },
    );
    return {
      status: result.status,
      redirectUrl: result.redirectUrl,
      failureCode: result.failureCode,
      invoice: await this.get(invoiceId),
    };
  }

  // -- Internals -----------------------------------------------------------------------------

  private async charge(invoice: InvoiceRow, card: CardRow, now: Date, returnUrl: string): Promise<VaultChargeResult> {
    const attempt = invoice.collectionAttempts + 1;
    let result: VaultChargeResult;
    try {
      result = await this.registry.vault.charge({
        token: this.registry.cipher.decrypt(card.encryptedToken),
        amountMinor: invoice.totalMinor,
        currency: invoice.currency,
        merchantRef: 'platform',
        orderRef: `invoice:${invoice.id}:${attempt}`,
        returnUrl,
      });
    } catch (error) {
      this.logger.warn(
        `vault charge for invoice ${invoice.id} failed: ${error instanceof Error ? error.message : 'error'}`,
      );
      result = { status: 'FAILED', providerRef: null, redirectUrl: null, failureCode: 'PROVIDER_ERROR' };
    }
    if (result.status === 'CAPTURED') {
      await this.settle(invoice, result.providerRef ?? `vault:${invoice.id}:${attempt}`, card.id, now);
      return result;
    }
    await this.prisma.commissionInvoice.update({
      where: { id: invoice.id },
      data: {
        collectionAttempts: attempt,
        lastCollectionAt: now,
        lastCollectionError: result.status === 'REQUIRES_3DS' ? 'REQUIRES_3DS' : (result.failureCode ?? 'FAILED'),
      },
    });
    return result;
  }

  private async settle(
    invoice: InvoiceRow,
    paymentRef: string,
    paymentMethodId: string | null,
    now: Date,
  ): Promise<void> {
    await this.prisma.commissionInvoice.update({
      where: { id: invoice.id },
      data: {
        status: CommissionInvoiceStatus.PAID,
        paidAt: now,
        paymentRef,
        paymentMethodId,
        lastCollectionError: null,
      },
    });
    await this.reinstateIfClear(invoice.restaurantId, null);
  }

  /** Lifts the marketplace suspension once no invoice of the restaurant is overdue any more. */
  private async reinstateIfClear(restaurantId: string, actorUserId: string | null): Promise<boolean> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { listingSuspendedAt: true },
    });
    if (!restaurant?.listingSuspendedAt) return false;
    const overdue = await this.prisma.commissionInvoice.count({
      where: { restaurantId, status: CommissionInvoiceStatus.OVERDUE },
    });
    if (overdue > 0) return false;
    await this.prisma.restaurant.update({ where: { id: restaurantId }, data: { listingSuspendedAt: null } });
    await this.audit(actorUserId, restaurantId, 'restaurant.listing_reinstated', 'restaurant', restaurantId, {});
    return true;
  }

  private async notifyOwner(invoice: InvoiceRow, templateKey: MessageTemplateKey): Promise<void> {
    try {
      const membership = await this.prisma.membership.findFirst({
        where: { restaurantId: invoice.restaurantId, status: 'ACTIVE', roleTemplate: { isOwner: true } },
        select: { user: { select: { phone: true, locale: true } }, restaurant: { select: { defaultLocale: true } } },
      });
      if (!membership) return;
      const locale = membership.user.locale ?? membership.restaurant.defaultLocale;
      await this.messaging.send({
        restaurantId: invoice.restaurantId,
        channel: 'SMS',
        to: membership.user.phone,
        templateKey,
        params: {
          restaurant: invoice.restaurant.name,
          period: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
            invoice.periodStart,
          ),
          amount: formatMoney({ amountMinor: invoice.totalMinor, currency: invoice.currency }, locale),
          due: invoice.dueAt ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(invoice.dueAt) : '',
        },
        locale,
        billable: false,
      });
    } catch (error) {
      this.logger.warn(
        `owner notice for invoice ${invoice.id} failed: ${error instanceof Error ? error.message : 'error'}`,
      );
    }
  }

  private audit(
    actorUserId: string | null,
    restaurantId: string,
    action: string,
    entity: string,
    entityId: string,
    meta: Prisma.InputJsonObject,
  ): Promise<unknown> {
    return this.prisma.auditLog.create({ data: { actorUserId, restaurantId, action, entity, entityId, meta } });
  }

  private appUrl(): string {
    return this.config.getOrThrow<string>('PUBLIC_APP_URL');
  }

  private async requireInvoice(id: string): Promise<InvoiceRow> {
    const row = await this.prisma.commissionInvoice.findUnique({ where: { id }, select: invoiceSelect });
    if (!row) throw notFound('INVOICE_NOT_FOUND', 'Invoice not found');
    return row;
  }

  private async get(id: string): Promise<CommissionInvoiceDTO> {
    return this.toDto(await this.requireInvoice(id));
  }

  private toDto(row: InvoiceRow): CommissionInvoiceDTO {
    return {
      id: row.id,
      periodStart: row.periodStart.toISOString(),
      periodEnd: row.periodEnd.toISOString(),
      currency: row.currency,
      orderCount: row.orderCount,
      baseMinor: row.baseMinor,
      commissionMinor: row.commissionMinor,
      vatMinor: row.vatMinor,
      totalMinor: row.totalMinor,
      status: row.status,
      issuedAt: row.issuedAt?.toISOString() ?? null,
      dueAt: row.dueAt?.toISOString() ?? null,
      paidAt: row.paidAt?.toISOString() ?? null,
      paymentRef: row.paymentRef,
      fiscalRef: row.fiscalRef,
      fiscalDocumentUrl: row.fiscalDocumentUrl,
      collectionAttempts: row.collectionAttempts,
      lastCollectionAt: row.lastCollectionAt?.toISOString() ?? null,
      lastCollectionError: row.lastCollectionError,
    };
  }

  private toAdminDto(row: InvoiceRow): AdminInvoiceDTO {
    return { ...this.toDto(row), restaurant: row.restaurant };
  }
}

function toCardDto(card: CardRow): SavedPaymentMethodDTO {
  return {
    id: card.id,
    provider: card.provider as CardVaultProviderCode,
    brand: card.brand,
    last4: card.last4,
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
    label: card.label,
    isDefault: card.isDefault,
  };
}
