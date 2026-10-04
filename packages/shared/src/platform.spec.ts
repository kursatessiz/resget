import {
  PLATFORM_FORBIDDEN_TENANT_PERMISSIONS,
  PLATFORM_PERMISSION_KEYS,
  PLATFORM_ROLES,
  platformRoleOf,
  platformRoleSystemKey,
  platformTenantPermissions,
  visibleMarketingNav,
} from './platform';

describe('platform marketing access', () => {
  it('never maps onto roles, staff, settings or money, even with every platform permission', () => {
    const all = platformTenantPermissions([...PLATFORM_PERMISSION_KEYS]);
    for (const forbidden of PLATFORM_FORBIDDEN_TENANT_PERMISSIONS) expect(all).not.toContain(forbidden);
    expect(all).toEqual(expect.arrayContaining(['customers.view', 'campaigns.manage']));
  });

  it('keeps the viewer read-only', () => {
    const viewer = platformTenantPermissions(PLATFORM_ROLES.marketing_viewer);
    expect(viewer.sort()).toEqual(['campaigns.view', 'customers.view', 'reports.view']);
  });

  it('round-trips the locked role key and rejects anything else', () => {
    expect(platformRoleOf(platformRoleSystemKey('marketing_editor'))).toBe('marketing_editor');
    expect(platformRoleOf('platform:owner')).toBeNull();
    expect(platformRoleOf('owner')).toBeNull();
    expect(platformRoleOf(null)).toBeNull();
  });

  it('builds the menu from permissions and switched-on modules', () => {
    const keys = visibleMarketingNav(['platform.marketing.view'], ['campaigns']).map((i) => i.key);
    expect(keys).toEqual(['overview', 'contacts', 'campaigns']);
    expect(visibleMarketingNav(['platform.marketing.view'], ['contacts_crm']).map((i) => i.key)).toEqual([
      'overview',
      'contacts',
      'pipeline',
      'tasks',
    ]);
    expect(visibleMarketingNav(['platform.marketing.view'], []).map((i) => i.key)).toEqual(['overview', 'contacts']);
    expect(visibleMarketingNav([], ['campaigns'])).toEqual([]);
  });
});
