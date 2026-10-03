import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksRunner } from './webhooks.runner';
import { WebhooksService } from './webhooks.service';

/** Outbound webhooks; global so the order flow can enqueue without importing the module everywhere. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhooksRunner],
  exports: [WebhooksService],
})
export class WebhooksModule {}
