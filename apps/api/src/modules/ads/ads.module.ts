import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdsController } from './ads.controller';
import { AdsRunner } from './ads.runner';
import { AdsService } from './ads.service';

/** Ad platform integrations (docs/REKLAM.md). Global so attribution can queue a conversion when it records one. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [AdsController],
  providers: [AdsService, AdsRunner],
  exports: [AdsService, AdsRunner],
})
export class AdsModule {}
