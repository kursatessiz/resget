import { Global, Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';

/** The append-only ledger writer; global so orders, payments and payouts share one instance. */
@Global()
@Module({ providers: [LedgerService], exports: [LedgerService] })
export class LedgerModule {}
