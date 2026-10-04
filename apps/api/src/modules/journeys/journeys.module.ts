import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JourneysController } from './journeys.controller';
import { JourneysRunner } from './journeys.runner';
import { JourneysService } from './journeys.service';

/** Automated flows (docs/AKISLAR.md). Global so the order flow can enrol customers when an order completes. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [JourneysController],
  providers: [JourneysService, JourneysRunner],
  exports: [JourneysService, JourneysRunner],
})
export class JourneysModule {}
