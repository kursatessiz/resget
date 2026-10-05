import { Module } from '@nestjs/common';
import { OrderingLinksController } from './ordering-links.controller';
import { OrderingLinksService } from './ordering-links.service';

/** Ordering links for outside channels (docs/SIPARIS_BAGLANTILARI.md). */
@Module({
  controllers: [OrderingLinksController],
  providers: [OrderingLinksService],
})
export class OrderingLinksModule {}
