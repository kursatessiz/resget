import { CreateApiKeySchema, apiKeyStatus, apiKeyUsageWindow } from './api-keys';

describe('API key expiry and usage window', () => {
  const now = new Date('2026-10-06T02:30:00.000Z');

  it('accepts only the offered lifetimes or none', () => {
    const base = { name: 'POS', permissions: ['orders.view'] };
    expect(CreateApiKeySchema.safeParse(base).success).toBe(true);
    expect(CreateApiKeySchema.safeParse({ ...base, expiresInDays: null }).success).toBe(true);
    expect(CreateApiKeySchema.safeParse({ ...base, expiresInDays: 90 }).success).toBe(true);
    expect(CreateApiKeySchema.safeParse({ ...base, expiresInDays: 7 }).success).toBe(false);
    expect(CreateApiKeySchema.safeParse({ ...base, expiresInDays: 30.5 }).success).toBe(false);
  });

  it('tells active, expired and revoked keys apart, revoked first', () => {
    expect(apiKeyStatus({ revokedAt: null, expiresAt: null }, now)).toBe('ACTIVE');
    expect(apiKeyStatus({ revokedAt: null, expiresAt: '2026-10-07T00:00:00.000Z' }, now)).toBe('ACTIVE');
    expect(apiKeyStatus({ revokedAt: null, expiresAt: now }, now)).toBe('EXPIRED');
    expect(apiKeyStatus({ revokedAt: '2026-10-01T00:00:00.000Z', expiresAt: now }, now)).toBe('REVOKED');
  });

  it('lists the UTC days of the window ending today, oldest first', () => {
    const days = apiKeyUsageWindow(now, 3);
    expect(days).toEqual(['2026-10-04', '2026-10-05', '2026-10-06']);
    expect(apiKeyUsageWindow(now)).toHaveLength(30);
    expect(apiKeyUsageWindow(new Date('2026-03-01T23:59:59.000Z'), 2)).toEqual(['2026-02-28', '2026-03-01']);
  });
});
