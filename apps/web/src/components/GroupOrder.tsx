'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GROUP_KEY_HEADER, formatMoney, groupCartPath } from '@resget/shared';
import type { GroupCartDTO, GroupMembershipDTO, StorefrontDTO, StorefrontViewerDTO } from '@resget/shared';
import { Storefront } from '@/components/Storefront';
import { Badge, Button, Card, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const storageKey = (token: string) => `resget.group.${token}`;

/** This browser's membership of a basket; the key never leaves this browser except as the x-group-key header. */
function readMembership(token: string): GroupMembershipDTO | null {
  try {
    const raw = window.localStorage.getItem(storageKey(token));
    return raw ? (JSON.parse(raw) as GroupMembershipDTO) : null;
  } catch {
    return null;
  }
}

function saveMembership(membership: GroupMembershipDTO): void {
  try {
    window.localStorage.setItem(storageKey(membership.token), JSON.stringify(membership));
  } catch {
    // Private mode: the membership lasts for this page only.
  }
}

/** The restaurant page's "start a group order" box (docs/GRUP_SIPARISI.md). */
export function StartGroupOrder({ slug, locale }: { slug: string; locale: string }) {
  const t = useT(locale);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const membership = await bffJson<GroupMembershipDTO>(`public/restaurants/${slug}/group-carts`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      saveMembership(membership);
      router.push(groupCartPath(slug, membership.token));
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
      setBusy(false);
    }
  };
  return (
    <Card title={t('group.start.title')} aria-label={t('group.start.title')}>
      <div className="flex flex-col gap-3">
        <p className="ui-text-muted">{t('group.start.intro')}</p>
        {open ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void start();
            }}
          >
            <TextField
              label={t('group.start.name')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
              required
            />
            <Button type="submit" disabled={busy || name.trim().length === 0}>
              {t('group.start.button')}
            </Button>
          </form>
        ) : (
          <Button variant="outline" tone="theme" onClick={() => setOpen(true)}>
            {t('group.start.button')}
          </Button>
        )}
        {error && (
          <p role="alert" className="ui-text-muted">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * The shared basket's page: who joined and what they chose, a join box for
 * a newcomer, and the ordering page in group mode for this browser's own
 * lines. Everyone's view refreshes every few seconds.
 */
export function GroupOrder({
  storefront,
  locale,
  token,
  viewer,
}: {
  storefront: StorefrontDTO;
  locale: string;
  token: string;
  viewer: StorefrontViewerDTO | null;
}) {
  const t = useT(locale);
  const [me, setMe] = useState<GroupMembershipDTO | null>(null);
  const [ready, setReady] = useState(false);
  const [cart, setCart] = useState<GroupCartDTO | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const money = (minor: number) =>
    formatMoney({ amountMinor: minor, currency: storefront.restaurant.currency }, locale);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });

  useEffect(() => {
    setMe(readMembership(token));
    setReady(true);
  }, [token]);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const load = useCallback(
    () =>
      bffJson<GroupCartDTO>(`public/group-carts/${token}`, me ? { headers: { [GROUP_KEY_HEADER]: me.key } } : {})
        .then((next) => {
          setCart(next);
          setError(null);
        })
        .catch(fail),
    [token, me, fail],
  );
  useEffect(() => {
    if (!ready) return undefined;
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, [ready, load]);

  const join = async () => {
    try {
      const membership = await bffJson<GroupMembershipDTO>(`public/group-carts/${token}/participants`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      saveMembership(membership);
      setMe(membership);
    } catch (err) {
      fail(err);
    }
  };

  const setLocked = async (locked: boolean) => {
    if (!me) return;
    try {
      setCart(
        await bffJson<GroupCartDTO>(`public/group-carts/${token}/${locked ? 'lock' : 'unlock'}`, {
          method: 'POST',
          headers: { [GROUP_KEY_HEADER]: me.key },
        }),
      );
    } catch (err) {
      fail(err);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const mine =
    cart && me && cart.youId === me.participantId ? cart.participants.find((p) => p.id === me.participantId) : null;
  const host = cart?.participants.find((p) => p.isHost) ?? null;
  const others = useMemo(
    () => (cart && me ? cart.participants.filter((p) => p.id !== me.participantId) : []),
    [cart, me],
  );

  return (
    <div className="flex flex-col gap-6">
      <Card
        title={t('group.title')}
        aria-label={t('group.title')}
        aside={
          cart && <Badge tone={cart.status === 'OPEN' ? 'success' : 'muted'}>{t(`group.status.${cart.status}`)}</Badge>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="ui-caption">{t('group.share')}</span>
            <Button variant="outline" tone="muted" onClick={() => void copy()}>
              {copied ? t('group.copied') : t('group.copy')}
            </Button>
          </div>
          {cart && cart.status !== 'PLACED' && (
            <p className="ui-caption">{t('group.expires', { time: time.format(new Date(cart.expiresAt)) })}</p>
          )}
          {cart && (
            <ul className="ui-divide" data-group-participants>
              {cart.participants.map((p) => (
                <li key={p.id} className="flex flex-col gap-1 py-2" data-participant={p.name}>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="ui-heading">{p.name}</span>
                    {p.isHost && <Badge tone="theme">{t('group.host')}</Badge>}
                    {me && p.id === me.participantId && <span className="ui-caption">{t('group.you')}</span>}
                    <span className="ui-caption">{t('group.subtotal', { amount: money(p.subtotalMinor) })}</span>
                  </span>
                  {p.lines.length === 0 ? (
                    <span className="ui-caption">{t('group.empty')}</span>
                  ) : (
                    p.lines.map((line, index) => (
                      <span key={index} className="ui-caption">
                        {t('group.line', { quantity: line.quantity, name: line.name })}
                        {line.modifiers.length > 0 ? ` (${line.modifiers.map((m) => m.name).join(', ')})` : ''}
                        {!line.available ? ` - ${t('group.unavailable')}` : ''}
                      </span>
                    ))
                  )}
                </li>
              ))}
            </ul>
          )}
          {cart && (
            <p className="ui-heading" data-group-total>
              {t('group.total', { amount: money(cart.totalMinor) })}
            </p>
          )}
          {cart?.youAreHost && cart.status !== 'PLACED' && (
            <div className="flex flex-col gap-1">
              <div>
                <Button variant="outline" tone="muted" onClick={() => void setLocked(cart.status === 'OPEN')}>
                  {cart.status === 'OPEN' ? t('group.lock') : t('group.unlock')}
                </Button>
              </div>
              <p className="ui-caption">{t('group.lockHint')}</p>
            </div>
          )}
          {cart && !cart.youAreHost && cart.status !== 'PLACED' && host && (
            <p className="ui-text-muted">{t('group.waitHost', { host: host.name })}</p>
          )}
          {cart?.status === 'PLACED' && <p role="status">{t('group.placed')}</p>}
          {error && (
            <p role="alert" className="ui-text-muted">
              {error}
            </p>
          )}
        </div>
      </Card>

      {ready && cart && !mine && cart.status === 'OPEN' && (
        <form
          className="flex flex-wrap items-end gap-2"
          aria-label={t('group.join.button')}
          onSubmit={(event) => {
            event.preventDefault();
            void join();
          }}
        >
          <p className="ui-text-muted w-full">{t('group.join.intro')}</p>
          <TextField
            label={t('group.join.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            required
          />
          <Button type="submit" disabled={name.trim().length === 0}>
            {t('group.join.button')}
          </Button>
        </form>
      )}

      {me && cart && mine && cart.status !== 'PLACED' && (
        <Storefront
          key={me.participantId}
          storefront={storefront}
          locale={locale}
          source={{ kind: 'site' }}
          viewer={viewer}
          group={{
            token,
            key: me.key,
            participantId: me.participantId,
            isHost: cart.youAreHost,
            closed: cart.status !== 'OPEN',
            initialLines: mine.lines,
            othersSubtotalMinor: others.reduce((sum, p) => sum + p.subtotalMinor, 0),
            othersLines: others.flatMap((p) =>
              p.lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, modifiers: l.modifiers })),
            ),
            onSaved: setCart,
          }}
        />
      )}
    </div>
  );
}
