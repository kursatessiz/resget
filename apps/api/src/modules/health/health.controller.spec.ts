import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
}

function mockResponse(): MockResponse {
  const res: MockResponse = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('HealthController', () => {
  const prisma = { $queryRaw: jest.fn() };
  const redis = { isConfigured: true, ping: jest.fn() };
  let controller: HealthController;

  beforeEach(async () => {
    jest.resetAllMocks();
    redis.ping.mockResolvedValue(true);
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: ConfigService, useValue: { get: (_k: string, d?: string) => d } },
      ],
    }).compile();
    controller = module.get(HealthController);
  });

  it('returns 200 ok when the database and Redis respond', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = mockResponse();
    await controller.check(res as never);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', database: expect.objectContaining({ status: 'ok' }) }),
    );
  });

  it('returns 503 degraded without leaking the database error', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('password authentication failed for user admin'));
    const res = mockResponse();
    await controller.check(res as never);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('password');
  });

  it('returns 503 when Redis is configured but unreachable', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    redis.ping.mockResolvedValueOnce(false);
    const res = mockResponse();
    await controller.check(res as never);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ redis: { status: 'error' } }));
  });
});
