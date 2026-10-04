import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SegmentsController } from './segments.controller';
import { SegmentsService } from './segments.service';

/** Segments v2 (docs/SEGMENTLER.md); global so campaigns can resolve a saved segment's audience. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [SegmentsController],
  providers: [SegmentsService],
  exports: [SegmentsService],
})
export class SegmentsModule {}
