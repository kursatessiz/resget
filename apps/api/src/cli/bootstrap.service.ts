import type { PrismaClient } from '@resget/database';
import { BUILT_IN_PLAN_CODES, DEFAULT_PLAN_EXCLUSIONS, PRO_TRIAL_DAYS_DEFAULT } from '@resget/shared';
import { maskPhone } from '../modules/messaging/sms.provider';

/**
 * Platform bootstrap (docs/PLATFORM_YONETIMI.md, docs/CICD_GUIDE.md). Runs
 * after every migration on the server and can be run by hand; it only ever
 * adds what is missing and never truncates or overwrites what the super
 * admin edited. Credit packages are business decisions and come from the
 * console, not from here.
 */
export interface BootstrapOptions {
  /** Currency of the plans created when none exist; ignored once plans exist. */
  currency: string | null;
  /** Monthly PRO price in minor units when the PRO plan is created; 0 until the owner sets it in the console. */
  proPriceMinor: number;
  superAdminPhone: string | null;
  superAdminName: string | null;
  /** Skip the super admin step even when a phone is configured (the deploy script's mode). */
  defaultsOnly: boolean;
  /** NODE_ENV: the mock courier network is created outside production only. */
  env: string;
}

export interface BootstrapReport {
  plansCreated: string[];
  plansSkipped: string[];
  mockCourierCreated: boolean;
  superAdmin: 'created' | 'promoted' | 'unchanged' | 'skipped';
  superAdminMasked: string | null;
  notices: string[];
}

export async function runBootstrap(prisma: PrismaClient, options: BootstrapOptions): Promise<BootstrapReport> {
  const report: BootstrapReport = {
    plansCreated: [],
    plansSkipped: [],
    mockCourierCreated: false,
    superAdmin: 'skipped',
    superAdminMasked: null,
    notices: [],
  };

  const existingPlans = new Set((await prisma.plan.findMany({ select: { code: true } })).map((p) => p.code));
  const missing = BUILT_IN_PLAN_CODES.filter((code) => !existingPlans.has(code));
  if (missing.length > 0 && !options.currency) {
    report.notices.push('plans missing but no currency given; pass --currency=<ISO 4217> to create them');
  }
  for (const code of BUILT_IN_PLAN_CODES) {
    if (existingPlans.has(code)) {
      report.plansSkipped.push(code);
      continue;
    }
    if (!options.currency) continue;
    await prisma.plan.create({
      data: {
        code,
        name: code === 'BASIC' ? 'Basic' : 'Pro',
        monthlyPriceMinor: code === 'BASIC' ? 0 : options.proPriceMinor,
        currency: options.currency,
        isFree: code === 'BASIC',
        trialDays: code === 'PRO' ? PRO_TRIAL_DAYS_DEFAULT : 0,
        excludedFeatures: [...DEFAULT_PLAN_EXCLUSIONS[code]],
      },
    });
    report.plansCreated.push(code);
    if (code === 'PRO' && options.proPriceMinor === 0) {
      report.notices.push('PRO created with price 0; set the monthly price in the console before selling it');
    }
  }

  if (options.env !== 'production') {
    const mock = await prisma.courierProvider.findUnique({ where: { code: 'MOCK' }, select: { id: true } });
    if (!mock) {
      await prisma.courierProvider.create({ data: { code: 'MOCK', name: 'Mock courier network', countryCode: 'XX' } });
      report.mockCourierCreated = true;
    }
  }

  if (!options.defaultsOnly && options.superAdminPhone) {
    report.superAdminMasked = maskPhone(options.superAdminPhone);
    const user = await prisma.user.findUnique({
      where: { phone: options.superAdminPhone },
      select: { id: true, isSuperAdmin: true },
    });
    if (!user) {
      await prisma.user.create({
        data: {
          phone: options.superAdminPhone,
          fullName: options.superAdminName ?? 'Platform Admin',
          isSuperAdmin: true,
        },
      });
      report.superAdmin = 'created';
    } else if (!user.isSuperAdmin) {
      await prisma.user.update({ where: { id: user.id }, data: { isSuperAdmin: true } });
      report.superAdmin = 'promoted';
    } else {
      report.superAdmin = 'unchanged';
    }
  }
  return report;
}
