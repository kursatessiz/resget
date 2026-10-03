import { Controller, Get, Headers, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { TrackingTokenSchema } from '@resget/shared';
import type { OrderTrackingDTO } from '@resget/shared';
import { ZodParam } from '../../common/zod-body.pipe';
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
