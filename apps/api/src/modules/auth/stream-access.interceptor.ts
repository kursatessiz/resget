import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, MessageEvent, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { StreamAccessService } from './stream-access.service';

/** Put on every authenticated @Sse handler through AuthorizedStream(); see StreamAccessService. */
@Injectable()
export class StreamAccessInterceptor implements NestInterceptor<MessageEvent, MessageEvent> {
  constructor(private readonly access: StreamAccessService) {}

  intercept(context: ExecutionContext, next: CallHandler<MessageEvent>): Observable<MessageEvent> {
    return this.access.guard(context, next.handle());
  }
}
