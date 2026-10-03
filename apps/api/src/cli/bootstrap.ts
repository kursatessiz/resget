import { PrismaClient } from '@resget/database';
import { z } from 'zod';
import { CurrencyCodeSchema, MinorAmountSchema, PhoneSchema } from '@resget/shared';
import { runBootstrap } from './bootstrap.service';

/**
 * Usage (inside the API image, after `prisma migrate deploy`):
 *   node dist/cli/bootstrap.js --defaults-only --currency=TRY
 *   node dist/cli/bootstrap.js --super-admin-phone=+905xxxxxxxxx --super-admin-name="Ad Soyad"
 * Flags fall back to BOOTSTRAP_CURRENCY, BOOTSTRAP_PRO_PRICE_MINOR,
 * BOOTSTRAP_SUPER_ADMIN_PHONE and BOOTSTRAP_SUPER_ADMIN_NAME. Idempotent.
 */
const OptionsSchema = z.object({
  currency: CurrencyCodeSchema.optional(),
  proPriceMinor: z.coerce.number().pipe(MinorAmountSchema).default(0),
  superAdminPhone: PhoneSchema.optional(),
  superAdminName: z.string().trim().min(2).max(120).optional(),
  defaultsOnly: z.boolean().default(false),
});

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq === -1) out[arg.slice(2)] = true;
    else out[arg.slice(2, eq)] = arg.slice(eq + 1);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pick = (flag: string, envKey: string): string | undefined => {
    const value = args[flag];
    if (typeof value === 'string' && value.length > 0) return value;
    const fromEnv = process.env[envKey];
    return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
  };
  const parsed = OptionsSchema.safeParse({
    currency: pick('currency', 'BOOTSTRAP_CURRENCY'),
    proPriceMinor: pick('pro-price-minor', 'BOOTSTRAP_PRO_PRICE_MINOR') ?? 0,
    superAdminPhone: pick('super-admin-phone', 'BOOTSTRAP_SUPER_ADMIN_PHONE'),
    superAdminName: pick('super-admin-name', 'BOOTSTRAP_SUPER_ADMIN_NAME'),
    defaultsOnly: args['defaults-only'] === true,
  });
  if (!parsed.success) {
    console.error(
      'bootstrap: invalid options',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
    process.exitCode = 2;
    return;
  }
  const prisma = new PrismaClient();
  try {
    const report = await runBootstrap(prisma, {
      currency: parsed.data.currency ?? null,
      proPriceMinor: parsed.data.proPriceMinor,
      superAdminPhone: parsed.data.superAdminPhone ?? null,
      superAdminName: parsed.data.superAdminName ?? null,
      defaultsOnly: parsed.data.defaultsOnly,
      env: process.env.NODE_ENV ?? 'development',
    });
    console.log(JSON.stringify({ bootstrap: report }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('bootstrap failed', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
