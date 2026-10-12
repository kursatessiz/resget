import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'node:crypto';
import { Prisma } from '@resget/database';
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_DELIVERY_RETENTION_DAYS,
  WEBHOOK_DISABLE_AFTER_FAILURES,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_PASS_PER_RESTAURANT,
  WEBHOOK_RETRY_DELAYS_SECONDS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TEST_PENDING_MAX,
  WEBHOOK_TEST_RATE_LIMIT,
  WEBHOOK_TEST_RATE_WINDOW_SECONDS,
  anonymizedAddressSnapshot,
  formatWebhookSignature,
  maskOrderContacts,
  webhookSignedPayload,
} from '@resget/shared';
import type {
  CreateWebhookInput,
  CreatedWebhookDTO,
  OrderSummaryDTO,
  PermissionKey,
  UpdateWebhookInput,
  WebhookDTO,
  WebhookDeliveryDTO,
  WebhookEnvelope,
  WebhookEvent,
} from '@resget/shared';
import { CredentialCipher, DEV_CREDENTIAL_KEY, EnvKeyProvider } from '../../common/crypto/credential-cipher';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimiterService } from '../redis/rate-limiter.service';
import { nonPublicUrlReason } from '../../common/net/public-address';
import { postToPublicHttps } from '../../common/net/public-https';
import { badRequest, conflict, forbidden, notFound } from '../../common/api-error';

const hookSelect = Prisma.validator<Prisma.RestaurantWebhookSelect>()({
  id: true,
  restaurantId: true,
  url: true,
  events: true,
  isActive: true,
  failureCount: true,
  lastDeliveryAt: true,
  lastStatus: true,
  createdAt: true,
});
type HookRow = Prisma.RestaurantWebhookGetPayload<{ select: typeof hookSelect }>;

/** How many due deliveries one pass sends and how long one receiver may take. */
const BATCH_SIZE = 50;
const TIMEOUT_MS = 5000;
const DAY_MS = 86_400_000;
/** A webhook body carries customer contacts only when the hook's creator may see them (docs/API_ERISIMI.md). */
const CONTACT_PERMISSION: PermissionKey = 'customers.contact.view';
/** Events whose body is about one order, and the field that names it; the ones account deletion reaches. */
const ORDER_SUBJECT_FIELD: Partial<Record<WebhookEvent, string>> = {
  'order.updated': 'id',
  'rating.created': 'orderId',
};

const deliveryInclude = Prisma.validator<Prisma.WebhookDeliveryInclude>()({
  webhook: {
    select: {
      id: true,
      restaurantId: true,
      url: true,
      secretEncrypted: true,
      failureCount: true,
      createdByUserId: true,
    },
  },
});
type DueDelivery = Prisma.WebhookDeliveryGetPayload<{ include: typeof deliveryInclude }>;

/**
 * Outbound webhooks (docs/API_ERISIMI.md). Enqueueing is cheap and never
 * fails an order flow; the runner sends due rows, signs every body with
 * the hook's secret and backs off on failure. A receiver that keeps
 * failing pauses its hook rather than being hammered forever.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly cipher: CredentialCipher;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly limiter: RateLimiterService,
  ) {
    this.cipher = new CredentialCipher(
      new EnvKeyProvider(this.config.get<string>('CREDENTIAL_ENCRYPTION_KEY') ?? DEV_CREDENTIAL_KEY),
    );
    this.fetchImpl = fetch;
  }

  // -- Management ----------------------------------------------------------------------------

  async list(restaurantId: string): Promise<WebhookDTO[]> {
    const rows = await this.prisma.restaurantWebhook.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'asc' },
      select: hookSelect,
    });
    return rows.map(toDto);
  }

  async create(restaurantId: string, userId: string, input: CreateWebhookInput): Promise<CreatedWebhookDTO> {
    this.assertUrl(input.url);
    const secret = `whsec_${randomBytes(32).toString('base64url')}`;
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.restaurantWebhook.create({
        data: {
          restaurantId,
          url: input.url,
          events: [...new Set(input.events)],
          secretEncrypted: this.cipher.encrypt(secret),
          createdByUserId: userId,
        },
        select: hookSelect,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          restaurantId,
          action: 'webhook.create',
          entity: 'restaurant_webhook',
          entityId: created.id,
          meta: { url: input.url, events: created.events },
        },
      });
      return created;
    });
    return { ...toDto(row), secret };
  }

  async update(restaurantId: string, userId: string, id: string, input: UpdateWebhookInput): Promise<WebhookDTO> {
    const existing = await this.require(restaurantId, id);
    if (input.url !== undefined) this.assertUrl(input.url);
    const data: Prisma.RestaurantWebhookUpdateInput = {};
    if (input.url !== undefined) data.url = input.url;
    if (input.events !== undefined) data.events = [...new Set(input.events)];
    if (input.isActive !== undefined) {
      data.isActive = input.isActive;
      // Resuming a paused hook is a fresh start for the failure streak.
      if (input.isActive && !existing.isActive) data.failureCount = 0;
    }
    const row = await this.prisma.restaurantWebhook.update({ where: { id }, data, select: hookSelect });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        restaurantId,
        action: 'webhook.update',
        entity: 'restaurant_webhook',
        entityId: id,
        meta: input,
      },
    });
    return toDto(row);
  }

  async remove(restaurantId: string, userId: string, id: string): Promise<void> {
    const removed = await this.prisma.restaurantWebhook.deleteMany({ where: { id, restaurantId } });
    if (removed.count === 0) throw notFound('WEBHOOK_NOT_FOUND', 'Webhook not found');
    await this.prisma.auditLog.create({
      data: { actorUserId: userId, restaurantId, action: 'webhook.delete', entity: 'restaurant_webhook', entityId: id },
    });
  }

  /**
   * A sample delivery so the receiver can be checked before real traffic. Limited per restaurant and per hook, so
   * test pings cannot fill the shared queue (docs/API_ERISIMI.md, "Deneme gönderimi").
   */
  async test(restaurantId: string, id: string): Promise<WebhookDeliveryDTO> {
    const hook = await this.require(restaurantId, id);
    if (
      (await this.limiter.hit(`rl:webhook-test:${restaurantId}`, WEBHOOK_TEST_RATE_WINDOW_SECONDS)) >
      WEBHOOK_TEST_RATE_LIMIT
    )
      throw forbidden('RATE_LIMITED', 'Too many test deliveries');
    const waiting = await this.prisma.webhookDelivery.count({
      where: { webhookId: hook.id, status: 'PENDING', payload: { path: ['test'], equals: true } },
    });
    if (waiting >= WEBHOOK_TEST_PENDING_MAX)
      throw conflict('WEBHOOK_TEST_LIMIT', 'Test deliveries of this endpoint are still waiting');
    const row = await this.prisma.webhookDelivery.create({
      data: {
        webhookId: hook.id,
        restaurantId,
        event: 'order.updated',
        payload: { test: true, restaurantId, sentFrom: 'panel' },
      },
    });
    return toDeliveryDto(row);
  }

  async deliveries(restaurantId: string, id: string): Promise<WebhookDeliveryDTO[]> {
    await this.require(restaurantId, id);
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { webhookId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map(toDeliveryDto);
  }

  /**
   * Sends a failed delivery again, under the same id so the receiver can
   * still drop a duplicate. Only an active hook takes it: a paused one would
   * leave it waiting unseen.
   */
  async redeliver(restaurantId: string, userId: string, id: string, deliveryId: string): Promise<WebhookDeliveryDTO> {
    const hook = await this.require(restaurantId, id);
    const delivery = await this.prisma.webhookDelivery.findFirst({ where: { id: deliveryId, webhookId: hook.id } });
    if (!delivery) throw notFound('WEBHOOK_NOT_FOUND', 'Delivery not found');
    if (!hook.isActive) throw conflict('WEBHOOK_REDELIVERY_NOT_ALLOWED', 'The endpoint is paused');
    // A body about a person who deleted their account is never sent again (docs/KISISEL_VERI.md).
    if (await this.subjectDeleted(restaurantId, delivery.event, delivery.payload))
      throw conflict('WEBHOOK_REDELIVERY_NOT_ALLOWED', 'The customer of this delivery deleted their account');
    const { count } = await this.prisma.webhookDelivery.updateMany({
      where: { id: deliveryId, status: 'FAILED' },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null, responseStatus: null },
    });
    if (count === 0) throw conflict('WEBHOOK_REDELIVERY_NOT_ALLOWED', 'Only a failed delivery is sent again');
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        restaurantId,
        action: 'webhook.redeliver',
        entity: 'webhook_delivery',
        entityId: deliveryId,
        meta: { webhookId: hook.id, event: delivery.event },
      },
    });
    return toDeliveryDto(await this.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } }));
  }

  // -- Queue ----------------------------------------------------------------------------------

  /** Opens one delivery per active hook subscribed to the event; a failure here is logged, never thrown. */
  async enqueue(restaurantId: string, event: WebhookEvent, data: unknown): Promise<number> {
    try {
      const hooks = await this.prisma.restaurantWebhook.findMany({
        where: { restaurantId, isActive: true, events: { has: event } },
        select: { id: true },
      });
      if (hooks.length === 0) return 0;
      await this.prisma.webhookDelivery.createMany({
        data: hooks.map((hook) => ({
          webhookId: hook.id,
          restaurantId,
          event,
          payload: data as Prisma.InputJsonValue,
        })),
      });
      return hooks.length;
    } catch (error) {
      this.logger.warn(`webhook enqueue failed: ${error instanceof Error ? error.message : 'error'}`);
      return 0;
    }
  }

  /**
   * Sends every due delivery once; returns how many reached a 2xx. The queue is shared by all restaurants, so a pass
   * takes at most WEBHOOK_PASS_PER_RESTAURANT rows of each and serves them in turns (the oldest of every restaurant
   * first): a long queue of one restaurant cannot hold the others' events.
   */
  async runPass(now: Date = new Date()): Promise<number> {
    const picked = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM (
        SELECT d.id, d."nextAttemptAt",
               row_number() OVER (PARTITION BY d."restaurantId" ORDER BY d."nextAttemptAt", d.id) AS turn
        FROM webhook_deliveries d
        JOIN restaurant_webhooks w ON w.id = d."webhookId"
        WHERE d.status = 'PENDING' AND d."nextAttemptAt" <= ${now} AND w."isActive" = true
      ) due
      WHERE turn <= ${WEBHOOK_PASS_PER_RESTAURANT}
      ORDER BY turn, "nextAttemptAt", id
      LIMIT ${BATCH_SIZE}`;
    if (picked.length === 0) return 0;
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { id: { in: picked.map((p) => p.id) }, status: 'PENDING' },
      include: deliveryInclude,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    // Asked once per hook and pass, and only when an order body is about to go out.
    const contacts = new Map<string, Promise<boolean>>();
    const seesContacts = (hook: DueDelivery['webhook']) => (): Promise<boolean> => {
      let answer = contacts.get(hook.id);
      if (!answer) {
        answer = this.creatorSeesContacts(hook.restaurantId, hook.createdByUserId);
        contacts.set(hook.id, answer);
      }
      return answer;
    };
    let sent = 0;
    for (const { id } of picked) {
      const delivery = byId.get(id);
      if (!delivery) continue;
      if (await this.deliver(delivery, now, seesContacts(delivery.webhook))) sent += 1;
    }
    return sent;
  }

  /** Deletes sent and failed deliveries past the retention period; the order data in their bodies goes with them. */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.webhookDelivery.deleteMany({
      where: {
        status: { in: ['SENT', 'FAILED'] },
        createdAt: { lt: new Date(now.getTime() - WEBHOOK_DELIVERY_RETENTION_DAYS * DAY_MS) },
      },
    });
    return count;
  }

  /**
   * Account deletion (docs/KISISEL_VERI.md): deliveries about the person's orders lose what identifies them. Waiting
   * and failed ones are dropped, so nothing about the person is sent or sent again; sent ones stay in the delivery
   * history without a name, a number, an address, a note or a comment. Runs inside the deletion transaction.
   */
  async forgetOrders(tx: Prisma.TransactionClient, orders: { id: string; restaurantId: string }[]): Promise<void> {
    if (orders.length === 0) return;
    const hooks = await tx.restaurantWebhook.findMany({
      where: { restaurantId: { in: [...new Set(orders.map((o) => o.restaurantId))] } },
      select: { id: true },
    });
    if (hooks.length === 0) return;
    const orderIds = orders.map((o) => o.id);
    const rows = await tx.$queryRaw<{ id: string; status: string; event: string; payload: Prisma.JsonValue }[]>`
      SELECT id, status::text AS status, event, payload FROM webhook_deliveries
      WHERE "webhookId" = ANY(${hooks.map((h) => h.id)}::text[])
        AND ((event = 'order.updated' AND payload->>'id' = ANY(${orderIds}::text[]))
          OR (event = 'rating.created' AND payload->>'orderId' = ANY(${orderIds}::text[])))`;
    const unsent = rows.filter((r) => r.status !== 'SENT').map((r) => r.id);
    if (unsent.length > 0) await tx.webhookDelivery.deleteMany({ where: { id: { in: unsent } } });
    for (const row of rows) {
      if (row.status !== 'SENT') continue;
      await tx.webhookDelivery.update({
        where: { id: row.id },
        data: { payload: redactedPayload(row.event, row.payload) as Prisma.InputJsonValue },
      });
    }
  }

  private async deliver(delivery: DueDelivery, now: Date, seesContacts: () => Promise<boolean>): Promise<boolean> {
    const envelope: WebhookEnvelope = {
      id: delivery.id,
      event: delivery.event as WebhookEvent,
      createdAt: delivery.createdAt.toISOString(),
      data: await this.bodyFor(delivery.event, delivery.payload, seesContacts),
    };
    const body = JSON.stringify(envelope);
    const timestamp = Math.floor(now.getTime() / 1000);
    const secret = this.cipher.decrypt(delivery.webhook.secretEncrypted);
    const digest = createHmac('sha256', secret).update(webhookSignedPayload(timestamp, body)).digest('hex');
    let status: number | null = null;
    let error: string | null = null;
    try {
      const headers = {
        'content-type': 'application/json',
        [WEBHOOK_EVENT_HEADER]: delivery.event,
        [WEBHOOK_DELIVERY_HEADER]: delivery.id,
        [WEBHOOK_SIGNATURE_HEADER]: formatWebhookSignature(timestamp, digest),
      };
      // In production the receiver is resolved once, at connect time, and refused if any answer is non-public, so the
      // address that is checked is the address that is used. Tests deliver to a local http receiver through fetch.
      const response =
        this.config.get<string>('NODE_ENV') === 'production'
          ? await postToPublicHttps(delivery.webhook.url, { headers, body, timeoutMs: TIMEOUT_MS })
          : await this.fetchImpl(delivery.webhook.url, {
              method: 'POST',
              headers,
              body,
              redirect: 'manual',
              signal: AbortSignal.timeout(TIMEOUT_MS),
            });
      status = response.status;
      if (status < 200 || status >= 300) error = `HTTP ${status}`;
    } catch (caught) {
      error = caught instanceof Error ? caught.message.slice(0, 200) : 'request failed';
    }
    const attempts = delivery.attempts + 1;
    if (!error) {
      await this.prisma.$transaction([
        this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: 'SENT', attempts, responseStatus: status, lastError: null, sentAt: now },
        }),
        this.prisma.restaurantWebhook.update({
          where: { id: delivery.webhook.id },
          data: { failureCount: 0, lastDeliveryAt: now, lastStatus: status },
        }),
      ]);
      return true;
    }
    const exhausted = attempts >= WEBHOOK_MAX_ATTEMPTS;
    const delay = WEBHOOK_RETRY_DELAYS_SECONDS[Math.min(attempts - 1, WEBHOOK_RETRY_DELAYS_SECONDS.length - 1)];
    const failures = delivery.webhook.failureCount + 1;
    await this.prisma.$transaction([
      this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: exhausted ? 'FAILED' : 'PENDING',
          attempts,
          responseStatus: status,
          lastError: error,
          nextAttemptAt: new Date(now.getTime() + delay * 1000),
        },
      }),
      this.prisma.restaurantWebhook.update({
        where: { id: delivery.webhook.id },
        data: {
          failureCount: failures,
          lastDeliveryAt: now,
          lastStatus: status,
          // A receiver that keeps failing is paused; the restaurant resumes it from the panel.
          ...(failures >= WEBHOOK_DISABLE_AFTER_FAILURES ? { isActive: false } : {}),
        },
      }),
    ]);
    return false;
  }

  /**
   * The body as the hook's creator may see it: like an API key (docs/API_ERISIMI.md rule 1), a hook never carries
   * more than its creator's current access, so order bodies mask customer phones unless the creator still holds
   * customers.contact.view. Checked at send time, so a narrowed role or a creator who left takes effect at once.
   */
  private async bodyFor(
    event: string,
    payload: Prisma.JsonValue,
    seesContacts: () => Promise<boolean>,
  ): Promise<unknown> {
    if (event !== 'order.updated' || !isOrderBody(payload)) return payload;
    return (await seesContacts()) ? payload : maskOrderContacts(payload);
  }

  /** The owner always sees contacts; anyone else only with an active membership whose role holds the permission. */
  private async creatorSeesContacts(restaurantId: string, userId: string | null): Promise<boolean> {
    if (!userId) return false;
    const membership = await this.prisma.membership.findFirst({
      where: { userId, restaurantId, status: 'ACTIVE', user: { deletedAt: null } },
      select: {
        roleTemplate: {
          select: {
            isOwner: true,
            permissions: { where: { permissionKey: CONTACT_PERMISSION }, select: { permissionKey: true } },
          },
        },
      },
    });
    if (!membership) return false;
    return membership.roleTemplate.isOwner || membership.roleTemplate.permissions.length > 0;
  }

  /** Whether the order a delivery is about belongs to a customer who deleted their account. */
  private async subjectDeleted(restaurantId: string, event: string, payload: Prisma.JsonValue): Promise<boolean> {
    const field = ORDER_SUBJECT_FIELD[event as WebhookEvent];
    if (!field || !payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const orderId = payload[field];
    if (typeof orderId !== 'string') return false;
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, restaurantId },
      select: { customer: { select: { deletedAt: true } } },
    });
    return order?.customer?.deletedAt != null;
  }

  /** In production a receiver is a public https address; tests deliver to a local receiver. */
  private assertUrl(url: string): void {
    if (this.config.get<string>('NODE_ENV') !== 'production') return;
    const reason = nonPublicUrlReason(url);
    if (reason) throw badRequest('WEBHOOK_URL_INVALID', `Receiver refused: ${reason}`);
  }

  private async require(restaurantId: string, id: string): Promise<HookRow> {
    const row = await this.prisma.restaurantWebhook.findFirst({ where: { id, restaurantId }, select: hookSelect });
    if (!row) throw notFound('WEBHOOK_NOT_FOUND', 'Webhook not found');
    return row;
  }
}

/** An order.updated body as the order flow stores it (`OrderSummaryDTO`); a test ping has no customer. */
function isOrderBody(payload: Prisma.JsonValue): payload is Prisma.JsonObject & OrderSummaryDTO {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const customer = payload.customer;
  return !!customer && typeof customer === 'object' && !Array.isArray(customer);
}

/** A sent delivery's body after its customer deleted the account: what identifies the person is gone. */
function redactedPayload(event: string, payload: Prisma.JsonValue): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (event === 'rating.created') return { ...payload, comment: null };
  if (!isOrderBody(payload)) return payload;
  return {
    ...payload,
    customer: { userId: payload.customer.userId, fullName: null, phone: null },
    address: payload.address ? (anonymizedAddressSnapshot(payload.address) as Prisma.JsonObject) : null,
    note: null,
  };
}

function toDto(row: HookRow): WebhookDTO {
  return {
    id: row.id,
    url: row.url,
    events: row.events as WebhookEvent[],
    isActive: row.isActive,
    failureCount: row.failureCount,
    lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
    lastStatus: row.lastStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDeliveryDto(row: {
  id: string;
  event: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  nextAttemptAt: Date;
  createdAt: Date;
  sentAt: Date | null;
}): WebhookDeliveryDTO {
  return {
    id: row.id,
    event: row.event as WebhookEvent,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.responseStatus,
    lastError: row.lastError,
    nextAttemptAt: row.status === 'PENDING' ? row.nextAttemptAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
  };
}
