import { Controller, Get, Headers, HttpCode, Patch, Post, Sse, UseGuards } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { EditRatingSchema, NpsAnswerSchema, RateOrderSchema, TrackingTokenSchema } from '@resget/shared';
import type { OrderTrackingDTO } from '@resget/shared';
import type { z } from 'zod';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { PublicRateLimitGuard, RateLimit } from '../storefront/public-rate-limit.guard';
import { RealtimeService, orderTopic } from '../realtime/realtime.service';
import { OrdersService } from './orders.service';

/**
 * The customer's tracking page, public behind an unguessable token. The
 * snapshot and the event stream expose only this order and the courier's
 * first name and position while on the way; never another customer.
 */
@Controller('public/orders')
export class PublicTrackingController {
  constructor(
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get(':token')
  snapshot(@ZodParam('token', TrackingTokenSchema) token: string): Promise<OrderTrackingDTO> {
    return this.orders.trackingByToken(token);
  }

  /** The customer rates a completed order once (docs/VITRIN.md); rate limited like the other anonymous writes. */
  @Post(':token/rating')
  @HttpCode(201)
  @UseGuards(PublicRateLimitGuard)
  @RateLimit({ bucket: 'funnel', limit: 20, windowSeconds: 600 })
  rate(
    @ZodParam('token', TrackingTokenSchema) token: string,
    @ZodBody(RateOrderSchema) body: z.infer<typeof RateOrderSchema>,
  ): Promise<OrderTrackingDTO> {
    return this.orders.rateByToken(token, body);
  }

  /** The customer edits their review for a day after writing it (docs/YORUMLAR.md). */
  @Patch(':token/rating')
  @UseGuards(PublicRateLimitGuard)
  @RateLimit({ bucket: 'funnel', limit: 20, windowSeconds: 600 })
  editRating(
    @ZodParam('token', TrackingTokenSchema) token: string,
    @ZodBody(EditRatingSchema) body: z.infer<typeof EditRatingSchema>,
  ): Promise<OrderTrackingDTO> {
    return this.orders.editRatingByToken(token, body);
  }

  /** The NPS question on the tracking page (docs/GERI_BILDIRIM.md); once per order. */
  @Post(':token/nps')
  @HttpCode(201)
  @UseGuards(PublicRateLimitGuard)
  @RateLimit({ bucket: 'funnel', limit: 20, windowSeconds: 600 })
  nps(
    @ZodParam('token', TrackingTokenSchema) token: string,
    @ZodBody(NpsAnswerSchema) body: z.infer<typeof NpsAnswerSchema>,
  ): Promise<OrderTrackingDTO> {
    return this.orders.answerNpsByToken(token, body);
  }

  /** SSE: the current state first, then every change (status, courier position, ETA). */
  @Sse(':token/events')
  async events(
    @ZodParam('token', TrackingTokenSchema) token: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Promise<Observable<MessageEvent>> {
    const tracking = await this.orders.trackingByToken(token);
    return this.realtime.stream(orderTopic(tracking.orderId), lastEventId, [{ type: 'tracking.updated', tracking }]);
  }
}
