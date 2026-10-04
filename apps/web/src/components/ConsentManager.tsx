'use client';

import { useEffect, useState } from 'react';
import { effectiveConsent } from '@resget/shared';
import type { ConsentChoice, ConsentRegime } from '@resget/shared';
import { Button } from '@/components/ui';
import { globalPrivacyControl, saveConsent, storedConsent, trackPageView } from '@/lib/tracking';
import { useT } from '@/lib/use-t';

interface Props {
  /** `platform` for the platform's own site, otherwise the restaurant slug. */
  target: string;
  regime: ConsentRegime;
  locale: string;
  /** Set on a table QR page so the visit is tied to the table. */
  tableToken?: string | null;
}

/**
 * The cookie banner and the visit beacon (docs/ATIF.md). Opt-in regions
 * (EU/EEA, UK, Switzerland, Canada) and Turkey (KVKK) measure nothing until
 * the visitor says yes; elsewhere an information banner is shown and
 * measurement starts at once, with advertising cookies one click away.
 * Global Privacy Control always switches advertising off. Once chosen, a
 * small link reopens the choice.
 */
export function ConsentManager({ target, regime, locale, tableToken = null }: Props) {
  const t = useT(locale);
  const [stored, setStored] = useState<ConsentChoice | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [advertising, setAdvertising] = useState(false);
  const gpc = ready && globalPrivacyControl();

  useEffect(() => {
    const choice = storedConsent();
    setStored(choice);
    setOpen(choice === null);
    setAnalytics(choice?.analytics ?? false);
    setAdvertising(choice?.advertising ?? false);
    setReady(true);
    void trackPageView(target, effectiveConsent(regime, choice, globalPrivacyControl()), tableToken);
  }, [target, regime, tableToken]);

  const choose = (choice: ConsentChoice) => {
    const before = effectiveConsent(regime, stored, gpc);
    saveConsent(choice);
    setStored(choice);
    setOpen(false);
    setDetails(false);
    const after = effectiveConsent(regime, choice, gpc);
    // A first yes counts this page; a NOTICE visitor was already counted on load.
    if (after.analytics && !before.analytics) void trackPageView(target, after, tableToken);
  };

  if (!ready) return null;

  if (!open) {
    return (
      <Button variant="link" tone="muted" onClick={() => setOpen(true)} data-consent-settings>
        {t('attribution.consent.settings')}
      </Button>
    );
  }

  const notice = regime === 'NOTICE';
  const body =
    regime === 'KVKK'
      ? t('attribution.consent.kvkk')
      : notice
        ? t('attribution.consent.notice')
        : t('attribution.consent.optIn');

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4" data-consent-banner={regime}>
      <section
        className="pui-card w-full max-w-2xl"
        role="dialog"
        aria-modal="false"
        aria-label={t('attribution.consent.title')}
      >
        <div className="pui-card-content flex flex-col gap-3">
          <h2 className="ui-heading">{t('attribution.consent.title')}</h2>
          <p className="ui-text-muted">{body}</p>
          {gpc && <p className="ui-caption">{t('attribution.consent.gpc')}</p>}
          {details && (
            <div className="flex flex-col gap-2" role="group" aria-label={t('attribution.consent.choose')}>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="pui-checkbox" checked disabled />
                <span>
                  <span>{t('attribution.consent.necessary')}</span>
                  <span className="ui-caption block">{t('attribution.consent.necessaryHelp')}</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="pui-checkbox"
                  checked={analytics}
                  onChange={(e) => {
                    setAnalytics(e.target.checked);
                    if (!e.target.checked) setAdvertising(false);
                  }}
                />
                <span>
                  <span>{t('attribution.consent.analytics')}</span>
                  <span className="ui-caption block">{t('attribution.consent.analyticsHelp')}</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="pui-checkbox"
                  checked={advertising && analytics && !gpc}
                  disabled={!analytics || gpc}
                  onChange={(e) => setAdvertising(e.target.checked)}
                />
                <span>
                  <span>{t('attribution.consent.advertising')}</span>
                  <span className="ui-caption block">{t('attribution.consent.advertisingHelp')}</span>
                </span>
              </label>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {details ? (
              <Button onClick={() => choose({ analytics, advertising: advertising && analytics })}>
                {t('attribution.consent.save')}
              </Button>
            ) : notice ? (
              <>
                <Button onClick={() => choose({ analytics: true, advertising: true })}>
                  {t('attribution.consent.ok')}
                </Button>
                <Button variant="outline" tone="muted" onClick={() => choose({ analytics: true, advertising: false })}>
                  {t('attribution.consent.noAds')}
                </Button>
              </>
            ) : (
              <>
                <Button onClick={() => choose({ analytics: true, advertising: true })}>
                  {t('attribution.consent.acceptAll')}
                </Button>
                <Button variant="outline" tone="muted" onClick={() => choose({ analytics: false, advertising: false })}>
                  {t('attribution.consent.rejectAll')}
                </Button>
              </>
            )}
            {!details && (
              <Button variant="link" tone="muted" onClick={() => setDetails(true)}>
                {t('attribution.consent.choose')}
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
