'use client';

import { useState } from 'react';
import { MENU_IMPORT_MAX_CHARS, menuImportTemplate } from '@resget/shared';
import type { MenuImportResultDTO, Translate } from '@resget/shared';
import { Button, Card } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';

/**
 * Spreadsheet import of the menu (docs/PANEL.md, "Menü içe aktarma"): the
 * file is read in the browser, checked by the API in a dry run, and applied
 * only after the preview shows no errors.
 */
export function MenuImport({
  restaurantId,
  t,
  onApplied,
}: {
  restaurantId: string;
  t: Translate;
  onApplied: () => Promise<void>;
}) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<MenuImportResultDTO | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const endpoint = `restaurants/${restaurantId}/menu/import`;

  const send = async (dryRun: boolean) => {
    if (!csv) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await bffJson<MenuImportResultDTO>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ csv, dryRun }),
      });
      setPreview(result);
      if (result.applied) {
        setMessage(t('menu.import.applied'));
        setCsv(null);
        setFileName('');
        await onApplied();
      }
    } catch (err) {
      setMessage(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File | null) => {
    setPreview(null);
    setMessage(null);
    if (!file) {
      setCsv(null);
      setFileName('');
      return;
    }
    const text = await file.text();
    if (text.length > MENU_IMPORT_MAX_CHARS) {
      setCsv(null);
      setMessage(t('menu.import.tooLarge'));
      return;
    }
    setCsv(text);
    setFileName(file.name);
  };

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(menuImportTemplate())}`;
  const canApply = preview !== null && preview.dryRun && preview.issues.length === 0 && preview.rows > 0;

  return (
    <Card title={t('menu.import.title')} aria-label={t('menu.import.title')}>
      <div className="flex flex-col gap-3">
        <p className="ui-text-muted">{t('menu.import.intro')}</p>
        <p className="ui-caption">{t('menu.import.columns')}</p>
        <div>
          <a className="pui-link pui-theme" href={templateHref} download="menu-template.csv">
            {t('menu.import.template')}
          </a>
        </div>
        <label className="pui-field-group" htmlFor="menu-import-file">
          <span>{t('menu.import.file')}</span>
          <input
            id="menu-import-file"
            type="file"
            className="pui-input"
            accept=".csv,text/csv,text/plain"
            onChange={(e) => void pick(e.target.files?.[0] ?? null)}
          />
          {fileName && <small className="ui-text-muted">{fileName}</small>}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" tone="muted" onClick={() => void send(true)} disabled={busy || !csv}>
            {t('menu.import.preview')}
          </Button>
          <Button onClick={() => void send(false)} disabled={busy || !canApply}>
            {t('menu.import.apply')}
          </Button>
        </div>
        {message && <p role="status">{message}</p>}
        {preview && (
          <div className="flex flex-col gap-2" aria-label={t('menu.import.summary')}>
            <p>
              {t('menu.import.counts', {
                rows: preview.rows,
                created: preview.itemsCreated,
                updated: preview.itemsUpdated,
                unchanged: preview.itemsUnchanged,
              })}
            </p>
            {preview.categoriesCreated.length > 0 && (
              <p className="ui-caption">
                {t('menu.import.newCategories', { names: preview.categoriesCreated.join(', ') })}
              </p>
            )}
            {preview.issues.length > 0 && (
              <ul className="ui-divide" aria-label={t('menu.import.issues')}>
                {preview.issues.slice(0, 50).map((issue) => (
                  <li key={`${issue.line}-${issue.code}-${issue.column ?? ''}`} className="py-1">
                    {t('menu.import.issueLine', {
                      line: issue.line,
                      problem: t(`menu.import.issue.${issue.code}`, { column: issue.column ?? '' }),
                    })}
                  </li>
                ))}
              </ul>
            )}
            {preview.issues.length > 50 && (
              <p className="ui-caption">{t('menu.import.moreIssues', { count: preview.issues.length - 50 })}</p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
