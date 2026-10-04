import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { PrismaClient } from '@resget/database';
import { normalizePhone } from '@resget/shared';
import { AppModule } from '../../../src/app.module';
import { ErrorCodeFilter } from '../../../src/common/error-code.filter';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JSON_BODY_LIMIT } from '../../../src/common/body-limit';

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
  // A small window keeps the rate limit scenario short; other suites place orders as staff, not through the public surface.
  process.env.PUBLIC_ORDER_RATE_LIMIT ??= '6';
  // Uploaded logos land in a scratch directory, never in the repository tree.
  process.env.UPLOADS_DIR ??= path.join(os.tmpdir(), 'resget-e2e-uploads');
  // Custom domains are verified against a stand-in resolver: hosts under .verified.test pass.
  process.env.DOMAIN_VERIFIER ??= 'MOCK';
  // Push goes to a stand-in provider: tokens containing 'gone' report the device as unregistered.
  process.env.PUSH_PROVIDER ??= 'MOCK';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('text', { type: 'text/plain', limit: JSON_BODY_LIMIT });
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
