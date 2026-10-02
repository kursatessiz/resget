import { ALL_PERMISSIONS, DEFAULT_ROLE_TEMPLATES, effectivePermissions, isPermissionKey } from './permissions';
import { BASE_MESSAGES } from './i18n/messages';

describe('permission catalogue', () => {
  it('has a Turkish name for every key', () => {
    for (const key of ALL_PERMISSIONS) {
      expect(BASE_MESSAGES[`permissions.${key}` as keyof typeof BASE_MESSAGES]).toBeTruthy();
    }
  });

  it('has a name for every default role template', () => {
    for (const role of DEFAULT_ROLE_TEMPLATES) {
      expect(BASE_MESSAGES[`roles.default.${role.key}` as keyof typeof BASE_MESSAGES]).toBeTruthy();
    }
  });

  it('owner template holds every permission and only one template is the owner', () => {
    const owners = DEFAULT_ROLE_TEMPLATES.filter((r) => r.isOwner);
    expect(owners).toHaveLength(1);
    expect([...owners[0].permissions].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('owners get everything, others only known granted keys', () => {
    expect(effectivePermissions(true, []).size).toBe(ALL_PERMISSIONS.length);
    expect([...effectivePermissions(false, ['orders.view', 'unknown.key'])]).toEqual(['orders.view']);
    expect(isPermissionKey('orders.view')).toBe(true);
    expect(isPermissionKey('constructor')).toBe(false);
  });
});
