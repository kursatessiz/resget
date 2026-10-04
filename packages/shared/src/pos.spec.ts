import { ConnectPosSchema, POS_PROVIDERS, posEventTransition } from './pos';

describe('POS integration', () => {
  it('maps POS events to order transitions only when they apply', () => {
    expect(posEventTransition('ACCEPTED', 'PLACED', 'PICKUP')).toBe('ACCEPTED');
    expect(posEventTransition('ACCEPTED', 'READY', 'PICKUP')).toBeNull();
    expect(posEventTransition('READY', 'ACCEPTED', 'DELIVERY')).toBe('READY');
    expect(posEventTransition('READY', 'PREPARING', 'DINE_IN')).toBe('READY');
    expect(posEventTransition('READY', 'PLACED', 'DELIVERY')).toBeNull();
    expect(posEventTransition('REJECTED', 'PLACED', 'DELIVERY')).toBe('REJECTED');
    expect(posEventTransition('REJECTED', 'PREPARING', 'DELIVERY')).toBe('CANCELLED_BY_RESTAURANT');
    expect(posEventTransition('REJECTED', 'DELIVERED', 'DELIVERY')).toBeNull();
  });

  it('lists the test POS as available and the partner POS systems as coming', () => {
    expect(POS_PROVIDERS.filter((p) => p.available).map((p) => p.code)).toEqual(['MOCK']);
    expect(POS_PROVIDERS.map((p) => p.code)).toEqual(
      expect.arrayContaining(['ROBOTPOS', 'ADISYO', 'SAMBAPOS', 'SIMPRA']),
    );
  });

  it('validates a connection', () => {
    const ok = { providerCode: 'MOCK', credentials: { storeId: 'S1' }, autoAccept: true, defaultPrepMinutes: 20 };
    expect(ConnectPosSchema.safeParse(ok).success).toBe(true);
    expect(ConnectPosSchema.safeParse({ ...ok, defaultPrepMinutes: 2 }).success).toBe(false);
  });
});
