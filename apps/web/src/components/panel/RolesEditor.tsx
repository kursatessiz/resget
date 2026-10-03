'use client';

import { useCallback, useEffect, useState } from 'react';
import { PERMISSION_KEYS } from '@resget/shared';
import type { PermissionKey, RoleTemplateDTO } from '@resget/shared';
import { Badge, Button, Card, LinkButton, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';
import { roleLabel } from './StaffManager';

/** Role templates of the restaurant: subsets of the permission catalogue the owner edits. */
export function RolesEditor({ restaurantId, slug, locale }: { restaurantId: string; slug: string; locale: string }) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/staff/roles`;
  const [roles, setRoles] = useState<RoleTemplateDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { name: string; permissions: Set<PermissionKey> }>>({});

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  const load = useCallback((list: RoleTemplateDTO[]) => {
    setRoles(list);
    setDrafts(Object.fromEntries(list.map((r) => [r.id, { name: r.name, permissions: new Set(r.permissions) }])));
  }, []);

  useEffect(() => {
    let cancelled = false;
    bffJson<RoleTemplateDTO[]>(base)
      .then((list) => {
        if (!cancelled) load(list);
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [base, fail, load]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await action();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const role = await bffJson<RoleTemplateDTO>(base, {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim(), permissions: [] }),
      });
      load([...(roles ?? []), role]);
      setNewName('');
    });

  const save = (role: RoleTemplateDTO) =>
    run(async () => {
      const draft = drafts[role.id];
      const updated = await bffJson<RoleTemplateDTO>(`${base}/${role.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: draft.name.trim(), permissions: [...draft.permissions] }),
      });
      load((roles ?? []).map((r) => (r.id === updated.id ? updated : r)));
      setSaved(updated.id);
    });

  const remove = (role: RoleTemplateDTO) => {
    if (!window.confirm(t('staff.roles.confirmDelete'))) return;
    void run(async () => {
      await bffJson<void>(`${base}/${role.id}`, { method: 'DELETE' });
      load((roles ?? []).filter((r) => r.id !== role.id));
    });
  };

  const setDraft = (id: string, patch: (draft: { name: string; permissions: Set<PermissionKey> }) => void) =>
    setDrafts((d) => {
      const next = { name: d[id].name, permissions: new Set(d[id].permissions) };
      patch(next);
      return { ...d, [id]: next };
    });

  if (!roles) {
    return (
      <>
        <h1 className="ui-title">{t('staff.roles.title')}</h1>
        <p className="ui-text-muted">{error ?? t('common.loading')}</p>
      </>
    );
  }

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="ui-title">{t('staff.roles.title')}</h1>
          <p className="ui-text-muted">{t('staff.roles.intro')}</p>
        </div>
        <LinkButton href={`/panel/${slug}/personel`} variant="outline" tone="muted">
          {t('staff.roles.back')}
        </LinkButton>
      </header>
      {error && (
        <p role="alert" className="ui-text-muted">
          {error}
        </p>
      )}

      <Card>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <TextField
            id="new-role"
            label={t('staff.roles.name')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={40}
            required
          />
          <Button type="submit" disabled={busy}>
            {t('staff.roles.add')}
          </Button>
        </form>
      </Card>

      {roles.map((role) => {
        const draft = drafts[role.id];
        if (!draft) return null;
        const label = roleLabel(t, role.templateKey, role.name);
        return (
          <Card
            key={role.id}
            aria-label={label}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {label}
                <Badge tone={role.isOwner ? 'theme' : 'muted'}>
                  {role.templateKey ? t('staff.roles.default') : t('staff.roles.custom')}
                </Badge>
                <span className="ui-caption">{t('staff.roles.memberCount', { count: role.memberCount })}</span>
              </span>
            }
            aside={
              !role.isOwner && (
                <Button
                  variant="link"
                  tone="error"
                  disabled={busy || role.memberCount > 0}
                  onClick={() => remove(role)}
                >
                  {t('staff.roles.delete')}
                </Button>
              )
            }
          >
            {!role.isOwner && (
              <TextField
                id={`role-name-${role.id}`}
                label={t('staff.roles.name')}
                value={draft.name}
                onChange={(e) => setDraft(role.id, (d) => void (d.name = e.target.value))}
                maxLength={40}
              />
            )}
            <fieldset className="flex flex-col gap-2">
              <legend className="ui-caption">{t('staff.roles.permissions')}</legend>
              {!role.isOwner && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="link"
                    tone="muted"
                    onClick={() => setDraft(role.id, (d) => void (d.permissions = new Set(PERMISSION_KEYS)))}
                  >
                    {t('staff.roles.selectAll')}
                  </Button>
                  <Button
                    variant="link"
                    tone="muted"
                    onClick={() => setDraft(role.id, (d) => void (d.permissions = new Set()))}
                  >
                    {t('staff.roles.clearAll')}
                  </Button>
                </div>
              )}
              <div className="grid gap-2 md:grid-cols-2">
                {PERMISSION_KEYS.map((key) => (
                  <label key={key} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="pui-checkbox mt-1"
                      checked={role.isOwner || draft.permissions.has(key)}
                      disabled={role.isOwner || busy}
                      onChange={(e) =>
                        setDraft(role.id, (d) => {
                          if (e.target.checked) d.permissions.add(key);
                          else d.permissions.delete(key);
                        })
                      }
                    />
                    <span>{t(`permissions.${key}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {!role.isOwner && (
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => void save(role)} disabled={busy}>
                  {t('common.save')}
                </Button>
                {saved === role.id && <span className="ui-caption">{t('common.saved')}</span>}
              </div>
            )}
          </Card>
        );
      })}
    </>
  );
}
