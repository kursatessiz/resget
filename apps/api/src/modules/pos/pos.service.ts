import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@resget/database';
import { POS_MAX_ATTEMPTS, POS_PROVIDERS, orderShortCode, posEventTransition } from '@resget/shared';
import type {
  ConnectPosInput,
  PosConnectionDTO,
  PosIntegrationAdapter,
  PosOrderPayload,
  PosSettingsDTO,
  UpdatePosInput,
} from '@resget/shared';
import { CredentialCipher, DEV_CREDENTIAL_KEY, EnvKeyProvider } from '../../common/crypto/credential-cipher';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { badRequest, notFound } from '../../common/api-error';
import { MockPosAdapter } from './mock-pos.adapter';

/** Backoff before push attempt n (1-based): 1, 2, 4, 8 minutes. */
const backoffMs = (attempt: number) => 2 ** Math.max(0, attempt - 1) * 60_000;

/**
 * POS integration (docs/POS_ENTEGRASYONU.md). Every order that becomes
 * PLACED is pushed to the restaurant's POS once (retried with backoff); an
 * auto-accepting connection then accepts the order with its default
 * preparation time. The POS reports back through a signed webhook that maps
 * onto the order state machine as the restaurant. Behind pos_integration.
 */
@Injectable()
export class PosService implements OnModuleInit {
  private readonly logger = new Logger(PosService.name);
  private readonly adapters = new Map<string, PosIntegrationAdapter>();
  readonly cipher: CredentialCipher;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly features: FeatureFlagsService,
    config: ConfigService,
  ) {
    // The test POS sends orders nowhere; production offers only real POS adapters.
    if (config.get<string>('NODE_ENV') !== 'production') this.register(new MockPosAdapter());
    this.cipher = new CredentialCipher(
      new EnvKeyProvider(config.get<string>('CREDENTIAL_ENCRYPTION_KEY') ?? DEV_CREDENTIAL_KEY),
    );
  }

  onModuleInit(): void {
    // Every order event reaches here; only a PLACED order without a sync row is pushed.
    this.orders.addOrderListener((order) => this.onOrderEvent(order));
  }

  register(adapter: PosIntegrationAdapter): void {
    this.adapters.set(adapter.code, adapter);
  }

  // -- Panel ---------------------------------------------------------------------------

  async settings(restaurantId: string): Promise<PosSettingsDTO> {
    const connection = await this.prisma.posConnection.findUnique({ where: { restaurantId } });
    if (!connection) return { providers: POS_PROVIDERS, connection: null };
    const recent = await this.prisma.posOrderSync.findMany({
      where: { connectionId: connection.id },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
    const dto: PosConnectionDTO = {
      providerCode: connection.providerCode,
      label: connection.label,
      status: connection.status,
      failureReason: connection.failureReason,
      autoAccept: connection.autoAccept,
      defaultPrepMinutes: connection.defaultPrepMinutes,
      isActive: connection.isActive,
      webhookPath: `/webhooks/pos/${connection.id}`,
      recent: recent.map((s) => ({
        orderShortCode: orderShortCode(s.orderId),
        status: s.status,
        attempts: s.attempts,
        lastError: s.lastError,
        updatedAt: s.updatedAt.toISOString(),
      })),
    };
    return { providers: POS_PROVIDERS, connection: dto };
  }

  async connect(restaurantId: string, actorUserId: string, input: ConnectPosInput): Promise<PosSettingsDTO> {
    const spec = POS_PROVIDERS.find((p) => p.code === input.providerCode);
    const adapter = this.adapters.get(input.providerCode);
    if (!spec?.available || !adapter) throw badRequest('VALIDATION', `No adapter for ${input.providerCode}`);
    const verification = await adapter.verifyCredentials(input.credentials);
    const data = {
      providerCode: input.providerCode,
      encryptedCredentials: this.cipher.encryptJson(input.credentials),
      keyVersion: this.cipher.keyVersion,
      label: verification.ok ? verification.label : input.providerCode,
      status: verification.ok ? ('ACTIVE' as const) : ('FAILED' as const),
      failureReason: verification.ok ? null : (verification.reason ?? 'verification failed'),
      autoAccept: input.autoAccept,
      defaultPrepMinutes: input.defaultPrepMinutes,
      isActive: true,
    };
    await this.prisma.posConnection.upsert({
      where: { restaurantId },
      create: { restaurantId, ...data },
      update: data,
    });
    await this.audit(restaurantId, actorUserId, 'pos.connect', {
      providerCode: input.providerCode,
      ok: verification.ok,
    });
    return this.settings(restaurantId);
  }

  async update(restaurantId: string, actorUserId: string, input: UpdatePosInput): Promise<PosSettingsDTO> {
    const updated = await this.prisma.posConnection.updateMany({ where: { restaurantId }, data: input });
    if (updated.count === 0) throw notFound('NOT_FOUND', 'No POS connection');
    await this.audit(restaurantId, actorUserId, 'pos.update', input as Record<string, unknown>);
    return this.settings(restaurantId);
  }

  async disconnect(restaurantId: string, actorUserId: string): Promise<PosSettingsDTO> {
    await this.prisma.posConnection.deleteMany({ where: { restaurantId } });
    await this.audit(restaurantId, actorUserId, 'pos.disconnect', {});
    return this.settings(restaurantId);
  }

  // -- Push ----------------------------------------------------------------------------

  /** Called for every order event; pushes a PLACED order the first time it is seen. Never throws. */
  async onOrderEvent(order: { id: string; restaurantId: string; status: string }): Promise<void> {
    if (order.status !== 'PLACED') return;
    try {
      const connection = await this.prisma.posConnection.findUnique({ where: { restaurantId: order.restaurantId } });
      if (!connection || !connection.isActive || connection.status !== 'ACTIVE') return;
      if (!(await this.features.isEnabled('pos_integration', order.restaurantId))) return;
      // The unique order id makes this the only push, whichever process sees the event first.
      const sync = await this.prisma.posOrderSync
        .create({ data: { restaurantId: order.restaurantId, connectionId: connection.id, orderId: order.id } })
        .catch((error: unknown) => {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
          throw error;
        });
      if (sync) await this.attempt(sync.id);
    } catch (error) {
      this.logger.warn(`POS push failed for order ${order.id}: ${error instanceof Error ? error.message : 'error'}`);
    }
  }

  /** Retries due pushes; the watchdog calls this once a minute. Returns how many were sent. */
  async retryDue(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.posOrderSync.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      select: { id: true },
      take: 100,
    });
    let sent = 0;
    for (const sync of due) if (await this.attempt(sync.id)) sent += 1;
    return sent;
  }

  private async attempt(syncId: string): Promise<boolean> {
    const sync = await this.prisma.posOrderSync.findUniqueOrThrow({
      where: { id: syncId },
      include: { connection: true },
    });
    const adapter = this.adapters.get(sync.connection.providerCode);
    if (!adapter) return false;
    const attempts = sync.attempts + 1;
    try {
      const payload = await this.payloadOf(sync.orderId);
      const result = await adapter.pushOrder(this.cipher.decryptJson(sync.connection.encryptedCredentials), payload);
      await this.prisma.posOrderSync.update({
        where: { id: sync.id },
        data: { status: 'SENT', externalRef: result.externalRef, attempts, lastError: null, nextAttemptAt: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : 'push failed';
      await this.prisma.posOrderSync.update({
        where: { id: sync.id },
        data: {
          status: attempts >= POS_MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
          attempts,
          lastError: message,
          nextAttemptAt: attempts >= POS_MAX_ATTEMPTS ? null : new Date(Date.now() + backoffMs(attempts)),
        },
      });
      return false;
    }
    // An auto-accepting POS took the order: accept it as the restaurant, unless a person already moved it.
    if (sync.connection.autoAccept) {
      await this.orders
        .transition(
          sync.restaurantId,
          sync.orderId,
          { to: 'ACCEPTED', prepMinutes: sync.connection.defaultPrepMinutes },
          'RESTAURANT',
          null,
          false,
        )
        .catch(() => undefined);
    }
    return true;
  }

  private async payloadOf(orderId: string): Promise<PosOrderPayload> {
    const row = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: { orderBy: { position: 'asc' } },
        table: { select: { label: true } },
        customer: { select: { fullName: true } },
      },
    });
    const address = this.orders.addressOf(row);
    return {
      orderId: row.id,
      shortCode: orderShortCode(row.id),
      placedAt: row.placedAt.toISOString(),
      fulfillment: row.fulfillment,
      currency: row.currency,
      items: row.items.map((item) => ({
        name: item.nameSnapshot,
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceMinor,
        modifiers: Array.isArray(item.modifiersSnapshot)
          ? (item.modifiersSnapshot as { name?: string }[]).map((m) => m.name ?? '').filter(Boolean)
          : [],
      })),
      itemsGrossMinor: row.itemsGrossMinor,
      deliveryFeeMinor: row.deliveryFeeMinor,
      discountMinor: row.discountMinor,
      chargedToCustomerMinor: row.chargedToCustomerMinor,
      paymentMethod: row.paymentMethod,
      note: row.customerNote,
      tableLabel: row.table?.label ?? null,
      customerName: row.customer?.fullName ?? null,
      address: address ? [address.addressLine, address.district, address.city].join(', ') : null,
    };
  }

  // -- Webhook -------------------------------------------------------------------------

  /** A signed status update from the POS: accepted (with a preparation time), ready or rejected. */
  async handleWebhook(
    connectionId: string,
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): Promise<{ applied: boolean }> {
    const connection = await this.prisma.posConnection.findUnique({ where: { id: connectionId } });
    if (!connection) throw notFound('NOT_FOUND', 'Unknown POS connection');
    const adapter = this.adapters.get(connection.providerCode);
    if (!adapter) throw notFound('NOT_FOUND', 'Unknown POS provider');
    let event;
    try {
      event = adapter.parseWebhook(this.cipher.decryptJson(connection.encryptedCredentials), rawBody, headers);
    } catch {
      throw badRequest('WEBHOOK_INVALID', 'Signature or payload rejected');
    }
    if (!(await this.features.isEnabled('pos_integration', connection.restaurantId))) return { applied: false };
    const sync = await this.prisma.posOrderSync.findFirst({
      where: { connectionId: connection.id, externalRef: event.externalRef },
      select: { orderId: true, order: { select: { status: true, fulfillment: true } } },
    });
    if (!sync) throw notFound('ORDER_NOT_FOUND', 'Unknown POS order reference');
    const to = posEventTransition(event.kind, sync.order.status, sync.order.fulfillment);
    if (!to) return { applied: false };
    await this.orders.transition(
      connection.restaurantId,
      sync.orderId,
      {
        to,
        ...(to === 'ACCEPTED' ? { prepMinutes: event.prepMinutes ?? connection.defaultPrepMinutes } : {}),
        ...(to === 'REJECTED' || to === 'CANCELLED_BY_RESTAURANT' ? { reason: event.reason ?? 'POS' } : {}),
      },
      'RESTAURANT',
      null,
      false,
    );
    return { applied: true };
  }

  private async audit(restaurantId: string, actorUserId: string, action: string, meta: Record<string, unknown>) {
    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        restaurantId,
        action,
        entity: 'PosConnection',
        entityId: restaurantId,
        meta: meta as Prisma.InputJsonValue,
      },
    });
  }
}
