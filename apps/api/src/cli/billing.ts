// Must stay the first import: empty variables from compose read as unset.
import '../config/unset-empty-env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BillingService } from '../modules/billing/billing.service';

/**
 * Runs the daily billing job once and prints the report as JSON:
 *   node dist/cli/billing.js [--as-of=2026-11-01T06:00:00Z]
 * The API process runs the same job on its own schedule; this command is for
 * cron with BILLING_SCHEDULER=off, for a backfill, or for a manual check.
 */
async function main(): Promise<void> {
  const arg = process.argv.find((a) => a.startsWith('--as-of='));
  const asOf = arg ? new Date(arg.slice('--as-of='.length)) : new Date();
  if (Number.isNaN(asOf.getTime())) {
    console.error('billing: --as-of must be an ISO date-time');
    process.exitCode = 2;
    return;
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const report = await app.get(BillingService).runDaily(asOf);
    console.log(JSON.stringify(report));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('billing: failed', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
