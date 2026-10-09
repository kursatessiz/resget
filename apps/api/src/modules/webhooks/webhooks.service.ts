import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'node:crypto';
import { Prisma } from '@resget/database';
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_DISABLE_AFTER_FAILURES,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_DELAYS_SECONDS,
  WEBHOOK_SIGNATURE_HEADER,
  formatWebhookSignature,
  webhookSignedPayload,
} from '@resget/shared';
import type {
  CreateWebhookInput,
  CreatedWebhookDTO,
  UpdateWebhookInput,
  WebhookDTO,
  WebhookDeliveryDTO,
  WebhookEnvelope,
  WebhookEvent,
} from '@resget/shared';
import { CredentialCipher, DEV_CREDENTIAL_KEY, EnvKeyProvider } from '../../common/crypto/credential-cipher';
import { PrismaService } from '../prisma/prisma.service';
import { nonPublicUrlReason, resolvesToNonPublic } from '../../common/net/public-address';
import { badRequest, conflict, notFound } from '../../common/api-error';

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

  /** A sample delivery so the receiver can be checked before real traffic. */
  async test(restaurantId: string, id: string): Promise<WebhookDeliveryDTO> {
    const hook = await this.require(restaurantId, id);
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

  /** Sends every due delivery once; returns how many reached a 2xx. */
  async runPass(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now }, webhook: { isActive: true } },
      orderBy: { nextAttemptAt: 'asc' },
      take: BATCH_SIZE,
      include: { webhook: { select: { id: true, url: true, secretEncrypted: true, failureCount: true } } },
    });
    let sent = 0;
    for (const delivery of due) {
      if (await this.deliver(delivery, now)) sent += 1;
    }
    return sent;
  }

  private async deliver(
    delivery: Prisma.WebhookDeliveryGetPayload<{
      include: { webhook: { select: { id: true; url: true; secretEncrypted: true; failureCount: true } } };
    }>,
    now: Date,
  ): Promise<boolean> {
    const envelope: WebhookEnvelope = {
      id: delivery.id,
      event: delivery.event as WebhookEvent,
      createdAt: delivery.createdAt.toISOString(),
      data: delivery.payload,
    };
    const body = JSON.stringify(envelope);
    const timestamp = Math.floor(now.getTime() / 1000);
    const secret = this.cipher.decrypt(delivery.webhook.secretEncrypted);
    const digest = createHmac('sha256', secret).update(webhookSignedPayload(timestamp, body)).digest('hex');
    let status: number | null = null;
    let error: string | null = null;
    try {
      // The name is resolved again right before the call, so a receiver whose DNS later points inside is refused.
      if (this.config.get<string>('NODE_ENV') === 'production' && (await resolvesToNonPublic(delivery.webhook.url))) {
        throw new Error('receiver resolves to a non-public address');
      }
      const response = await this.fetchImpl(delivery.webhook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [WEBHOOK_EVENT_HEADER]: delivery.event,
          [WEBHOOK_DELIVERY_HEADER]: delivery.id,
          [WEBHOOK_SIGNATURE_HEADER]: formatWebhookSignature(timestamp, digest),
        },
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
