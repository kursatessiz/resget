import { FEATURE_KEYS } from '@resget/shared';
import type { MembershipSummaryDTO } from '@resget/shared';
import { pickMembership, tabsFor } from './tabs';

const ON = FEATURE_KEYS;

const membership = (restaurantId: string, status: MembershipSummaryDTO['status']): MembershipSummaryDTO => ({
  membershipId: `m-${restaurantId}`,
  restaurantId,
  restaurantName: restaurantId,
  restaurantSlug: restaurantId,
  status,
  isOwner: false,
  roleName: 'courier',
  permissions: ['courier.deliver'],
  effectivePlan: 'BASIC',
  planName: 'Basic',
  entitlements: [],
  themePrimary: '#0092cd',
  logoUrl: null,
  features: [...FEATURE_KEYS],
});

describe('mobile navigation', () => {
  it('builds tabs from permissions and always offers own orders and the account', () => {
    expect(tabsFor(['courier.deliver', 'orders.view'], ON)).toEqual(['courier', 'orders', 'myOrders', 'account']);
    expect(tabsFor(['orders.view'], ON)).toEqual(['orders', 'myOrders', 'account']);
    expect(tabsFor([], ON)).toEqual(['myOrders', 'account']);
    expect(tabsFor(['dispatch.view', 'orders.view'], ON)).toEqual(['dispatch', 'orders', 'myOrders', 'account']);
  });

  it('hides the courier and dispatch tabs while the own-courier module is switched off', () => {
    const off = FEATURE_KEYS.filter((key) => key !== 'own_courier_dispatch');
    expect(tabsFor(['courier.deliver', 'dispatch.view', 'orders.view'], off)).toEqual([
      'orders',
      'myOrders',
      'account',
    ]);
  });

  it('opens the last chosen active restaurant, else the first active one', () => {
    const list = [membership('a', 'PASSIVE'), membership('b', 'ACTIVE'), membership('c', 'ACTIVE')];
    expect(pickMembership(list, 'c')?.restaurantId).toBe('c');
    expect(pickMembership(list, 'a')?.restaurantId).toBe('b');
    expect(pickMembership(list, null)?.restaurantId).toBe('b');
    expect(pickMembership([membership('a', 'INVITED')], null)).toBeNull();
  });
});
