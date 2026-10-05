import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';

/** Accounting export (docs/MUHASEBE_AKTARIMI.md). */
@Module({
  controllers: [AccountingController],
  providers: [AccountingService],
})
export class AccountingModule {}
