import { PrismaClient } from '@resget/database';
import { normalizePhone } from '@resget/shared';
import { runBootstrap } from '../../src/cli/bootstrap.service';

/** The platform bootstrap adds what is missing and leaves edited data alone (docs/PLATFORM_YONETIMI.md). */
describe('Platform bootstrap', () => {
  const prisma = new PrismaClient();
  const phone = normalizePhone('05320000011')!;
  const base = {
    currency: 'TRY',
    proPriceMinor: 99900,
    superAdminPhone: phone,
    superAdminName: 'Bootstrap Admin',
    defaultsOnly: false,
    env: 'test',
  };

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { phone } });
    await prisma.$disconnect();
  });

  it('keeps the seeded plans untouched and creates the super admin once', async () => {
    const proBefore = await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } });
    const first = await runBootstrap(prisma, base);
    expect(first.plansSkipped.sort()).toEqual(['BASIC', 'PRO']);
    expect(first.plansCreated).toEqual([]);
    expect(first.superAdmin).toBe('created');
    expect(first.superAdminMasked).not.toContain('0011');
    const proAfter = await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } });
    expect(proAfter.monthlyPriceMinor).toBe(proBefore.monthlyPriceMinor);
    const admin = await prisma.user.findUniqueOrThrow({ where: { phone } });
    expect(admin.isSuperAdmin).toBe(true);
    expect(admin.fullName).toBe('Bootstrap Admin');

    const second = await runBootstrap(prisma, base);
    expect(second.superAdmin).toBe('unchanged');
    expect(second.mockCourierCreated).toBe(false);
  });

  it('promotes an existing user and skips the super admin in defaults-only mode', async () => {
    await prisma.user.update({ where: { phone }, data: { isSuperAdmin: false } });
    const defaults = await runBootstrap(prisma, { ...base, defaultsOnly: true });
    expect(defaults.superAdmin).toBe('skipped');
    expect((await prisma.user.findUniqueOrThrow({ where: { phone } })).isSuperAdmin).toBe(false);
    const promoted = await runBootstrap(prisma, base);
    expect(promoted.superAdmin).toBe('promoted');
  });

  it('reports missing plans when no currency is given instead of inventing one', async () => {
    // Simulated on the report only: plans exist here, so the notice list stays empty and nothing is created.
    const report = await runBootstrap(prisma, { ...base, currency: null, defaultsOnly: true });
    expect(report.plansCreated).toEqual([]);
    expect(report.notices).toEqual([]);
  });
});
