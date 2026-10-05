'use client';

import { useEffect, useState } from 'react';
import { formatMoney } from '@resget/shared';
import type { OrderSource, OrderingLinksDTO } from '@resget/shared';
import { Button, Card, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/**
 * One ordering link per outside channel and what each brought in the last
 * days (docs/SIPARIS_BAGLANTILARI.md). The restaurant copies a link and
 * pastes it where the channel's instructions say.
 */
export function OrderingLinks({ restaurantId, locale }: { restaurantId: string; locale: string }) {
  const t = useT(locale);
  const [data, setData] = useState<OrderingLinksDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<OrderSource | null>(null);
  const [copyFailed, setCopyFailed] = useState<OrderSource | null>(null);

  useEffect(() => {
    bffJson<OrderingLinksDTO>(`restaurants/${restaurantId}/ordering-links`)
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('orderingLinks.loadError')),
      );
  }, [restaurantId, t]);

  const copy = async (source: OrderSource, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(source);
      setCopyFailed(null);
    } catch {
      setCopied(null);
      setCopyFailed(source);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('orderingLinks.title')}</h1>
        <p className="ui-text-muted">{t('orderingLinks.intro')}</p>
        {data && <p className="ui-caption">{t('orderingLinks.base', { url: data.baseUrl })}</p>}
      </header>
      {error && (
        <p role="alert" className="pui-badge pui-soft pui-error">
          {error}
        </p>
      )}
      {data && (
        <div className="grid gap-4 md:grid-cols-2">
          {data.links.map((link) => {
            const name = t(`orderingLinks.source.${link.source}`);
            return (
              <Card key={link.source} title={name} data-source={link.source}>
                <div className="flex flex-col gap-3">
                  <p className="ui-caption">{t(`orderingLinks.where.${link.source}`)}</p>
                  <TextField
                    label={t('orderingLinks.link', { source: name })}
                    value={link.url}
                    readOnly
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" tone="theme" onClick={() => void copy(link.source, link.url)}>
                      {copied === link.source ? t('orderingLinks.copied') : t('orderingLinks.copy')}
                    </Button>
                    {copyFailed === link.source && <span className="ui-caption">{t('orderingLinks.copyFailed')}</span>}
                  </div>
                  <p className="ui-heading" data-orders={link.orders}>
                    {t('orderingLinks.stats', {
                      count: link.orders,
                      days: data.windowDays,
                      amount: formatMoney({ amountMinor: link.revenueMinor, currency: data.currency }, locale),
                    })}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {data && data.otherOrders > 0 && (
        <p className="ui-text-muted">{t('orderingLinks.other', { count: data.otherOrders })}</p>
      )}
    </div>
  );
}
