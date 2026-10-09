import type { SystemHealthDTO } from '@resget/shared';
import { Badge, Card } from '@/components/ui';
import type { UiTone } from '@/components/ui/types';
import { apiFetch } from '@/lib/api-server';
import { getT } from '@/lib/i18n';

const STATUS_TONE: Record<SystemHealthDTO['database']['status'], UiTone> = {
  ok: 'success',
  error: 'error',
  not_configured: 'muted',
};

/** Live system page of the console (docs/PLATFORM_YONETIMI.md); server rendered, measured on every open. */
export default async function AdminSystemPage() {
  const { t, locale } = await getT();
  const res = await apiFetch('/admin/system');
  if (!res.ok) throw new Error(`admin system failed with ${res.status}`);
  const health = (await res.json()) as SystemHealthDTO;
  const count = new Intl.NumberFormat(locale);
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const balance = (p: SystemHealthDTO['providers']['sms']) =>
    p.balance === null
      ? t('admin.system.balanceUnknown')
      : t('admin.system.balance', { balance: count.format(p.balance) });
  const activity: [keyof SystemHealthDTO['activity'], number][] = [
    ['ordersLastHour', health.activity.ordersLastHour],
    ['ordersLast24h', health.activity.ordersLast24h],
    ['acceptanceOverdue', health.activity.acceptanceOverdue],
    ['messagesSent', health.activity.messagesSentLast24h],
    ['messagesFailed', health.activity.messagesFailedLast24h],
    ['openInvoices', health.activity.openInvoices],
    ['overdueInvoices', health.activity.overdueInvoices],
    ['suspendedListings', health.activity.suspendedListings],
    ['activeRestaurants', health.activity.activeRestaurants],
  ] as [keyof SystemHealthDTO['activity'], number][];

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('admin.system.title')}</h1>
        <p className="ui-text-muted">{t('admin.system.intro')}</p>
        <p className="ui-caption">
          {t('admin.system.release', { release: health.release })}.{' '}
          {t('admin.system.uptime', { hours: Math.floor(health.uptimeSeconds / 3600) })}.
        </p>
      </header>

      <Card title={t('admin.system.components')} aria-label={t('admin.system.components')}>
        <ul className="flex flex-col gap-2">
          <li className="flex items-center justify-between gap-2">
            <span>{t('admin.system.database')}</span>
            <span className="flex items-center gap-2">
              <span className="ui-caption">{t('admin.system.latency', { ms: health.database.latencyMs })}</span>
              <Badge tone={STATUS_TONE[health.database.status]}>
                {t(`admin.system.status.${health.database.status}`)}
              </Badge>
            </span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span>{t('admin.system.redis')}</span>
            <Badge tone={STATUS_TONE[health.redis.status]}>{t(`admin.system.status.${health.redis.status}`)}</Badge>
          </li>
        </ul>
      </Card>

      <Card title={t('admin.system.jobs')} aria-label={t('admin.system.jobs')}>
        <ul className="flex flex-col gap-2">
          <li className="flex items-center justify-between gap-2">
            <span>
              {t('admin.system.billingScheduler')}.{' '}
              <span className="ui-caption">
                {health.jobs.billingLastRunAt
                  ? t('admin.system.billingLastRun', { date: when(health.jobs.billingLastRunAt) })
                  : t('admin.system.billingNeverRan')}
              </span>
            </span>
            <Badge tone={health.jobs.billingScheduler === 'on' ? 'success' : 'muted'}>
              {t(`admin.system.${health.jobs.billingScheduler}`)}
            </Badge>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span>{t('admin.system.orderWatchdog')}</span>
            <Badge tone={health.jobs.orderWatchdog === 'on' ? 'success' : 'muted'}>
              {t(`admin.system.${health.jobs.orderWatchdog}`)}
            </Badge>
          </li>
        </ul>
      </Card>

      <Card title={t('admin.system.providers')} aria-label={t('admin.system.providers')}>
        <ul className="flex flex-col gap-2">
          {(['sms', 'whatsapp'] as const).map((key) => (
            <li key={key} className="flex items-center justify-between gap-2">
              <span>
                {t(`admin.system.provider.${key}`)}: {health.providers[key].code}
              </span>
              <span className="flex items-center gap-2">
                <span className="ui-caption">{balance(health.providers[key])}</span>
                {health.providers[key].low && <Badge tone="error">{t('admin.system.balanceLow')}</Badge>}
              </span>
            </li>
          ))}
          {(['payment', 'cardVault', 'courier', 'invoice', 'consentRegistry', 'routing'] as const).map((key) => (
            <li key={key} className="flex items-center justify-between gap-2">
              <span>{t(`admin.system.provider.${key}`)}</span>
              <Badge tone={health.providers[key] === 'MOCK' || health.providers[key] === 'NONE' ? 'warn' : 'muted'}>
                {health.providers[key]}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t('admin.system.activity')} aria-label={t('admin.system.activity')}>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {activity.map(([key, value]) => (
            <div key={key}>
              <dt className="ui-caption">{t(`admin.system.${key}`)}</dt>
              <dd className="ui-price">{count.format(value)}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title={t('admin.system.wallets')} aria-label={t('admin.system.wallets')}>
        <ul className="flex flex-col gap-1">
          {health.wallets.map((w) => (
            <li key={w.channel}>
              {t('admin.system.walletLine', { channel: w.channel, balance: count.format(w.totalBalance) })}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
