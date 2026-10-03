import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@resget/database';
import { normalizePhone } from '@resget/shared';
import { AppModule } from '../../../src/app.module';
import { ErrorCodeFilter } from '../../../src/common/error-code.filter';

/**
 * Boots the real application against the seeded database the CI job (or a
 * developer) prepared with `prisma migrate deploy` and `db:seed`. The suites
 * log in with the fixed OTP (OTP_TEST_CODE) and clean up what they create.
 */
export const OTP_TEST_CODE = process.env.OTP_TEST_CODE ?? '482915';
export const SEED = {
  superAdminPhone: normalizePhone('05320000001')!,
  ownerPhone: normalizePhone('05320000002')!,
  guestPhone: normalizePhone('05320000003')!,
  restaurantSlug: 'demo-lokanta',
  tableToken: 'demo-masa-1-sabit-token-0001',
};

export interface TestContext {
  app: INestApplication;
  prisma: PrismaClient;
  http: () => request.Agent;
  /** Access token for a phone, through the real OTP flow. */
  login: (phone: string) => Promise<string>;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
  process.env.NODE_ENV = 'test';
  process.env.OTP_TEST_CODE = OTP_TEST_CODE;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ErrorCodeFilter());
  await app.init();
  const prisma = new PrismaClient();
  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);

  const login = async (phone: string): Promise<string> => {
    // The request limit (3 per window) would trip across suites; tests reset it.
    await prisma.otpCode.deleteMany({ where: { phone } });
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const res = await http().post('/auth/otp/verify').send({ phone, code: OTP_TEST_CODE }).expect(200);
    return res.body.accessToken as string;
  };

  return {
    app,
    prisma,
    http,
    login,
    close: async () => {
      await prisma.$disconnect();
      await app.close();
    },
  };
}

export function bearer(token: string, restaurantId?: string): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (restaurantId) headers['x-restaurant-id'] = restaurantId;
  return headers;
}
