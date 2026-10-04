import type { MembershipSummaryDTO } from '@resget/shared';
import { pickMembership, tabsFor } from './tabs';

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
  themePrimary: '#0092cd',
  logoUrl: null,
});

describe('mobile navigation', () => {
  it('builds tabs from permissions and always offers own orders and the account', () => {
    expect(tabsFor(['courier.deliver', 'orders.view'])).toEqual(['courier', 'orders', 'myOrders', 'account']);
    expect(tabsFor(['orders.view'])).toEqual(['orders', 'myOrders', 'account']);
    expect(tabsFor([])).toEqual(['myOrders', 'account']);
  });

  it('opens the last chosen active restaurant, else the first active one', () => {
    const list = [membership('a', 'PASSIVE'), membership('b', 'ACTIVE'), membership('c', 'ACTIVE')];
    expect(pickMembership(list, 'c')?.restaurantId).toBe('c');
    expect(pickMembership(list, 'a')?.restaurantId).toBe('b');
    expect(pickMembership(list, null)?.restaurantId).toBe('b');
    expect(pickMembership([membership('a', 'INVITED')], null)).toBeNull();
  });
});
