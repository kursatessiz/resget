'use client';

import { useCallback, useEffect, useState } from 'react';
import { SITE_BLOCK_TYPES, SITE_PAGE_STATUSES, UpsertSitePageSchema, sitePagePath } from '@resget/shared';
import type { MarketplaceAreaDTO, SiteBlock, SiteBlockType, SitePageDTO, SitePageStatus } from '@resget/shared';
import { Badge, Button, Card, SelectField, TextAreaField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

interface Draft {
  id: string | null;
  path: string;
  locale: string;
  title: string;
  description: string;
  translationKey: string;
  status: SitePageStatus;
  blocks: SiteBlock[];
}

type Item = Record<string, string>;

const areaKey = (a: MarketplaceAreaDTO) => `${a.countryCode}|${a.city}|${a.district}`;

function emptyBlock(type: SiteBlockType, areas: MarketplaceAreaDTO[]): SiteBlock {
  switch (type) {
    case 'hero':
      return { type, heading: '' };
    case 'text':
      return { type, body: '' };
    case 'features':
      return { type, items: [{ title: '', body: '' }] };
    case 'faq':
      return { type, items: [{ question: '', answer: '' }] };
    case 'cta':
      return { type, heading: '', label: '', href: '/' };
    case 'restaurants':
      return { type, area: areas[0] ? areaKey(areas[0]) : '' };
  }
}

/** Optional text left empty is dropped so the schema sees it as absent. */
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => !(typeof v === 'string' && v.trim() === ''))
        .map(([k, v]) => [k, clean(v)]),
    );
  }
  return value;
}

/**
 * The platform's engine pages (docs/SAYFA_MOTORU.md): list, create, edit
 * blocks, publish and delete. Everything entered is plain text.
 */
export function SitePagesManager({
  restaurantId,
  locale,
  canManage,
  areas,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
  areas: MarketplaceAreaDTO[];
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/site/pages`;
  const [pages, setPages] = useState<SitePageDTO[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

  const load = useCallback(async () => setPages(await bffJson<SitePageDTO[]>(base)), [base]);
  useEffect(() => {
    load().catch(fail);
  }, [load, fail]);

  const startNew = () =>
    setDraft({
      id: null,
      path: '',
      locale,
      title: '',
      description: '',
      translationKey: '',
      status: 'DRAFT',
      blocks: [emptyBlock('hero', areas)],
    });
  const startEdit = (page: SitePageDTO) =>
    setDraft({ ...page, translationKey: page.translationKey ?? '', blocks: page.blocks });

  const patch = (fields: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...fields } : d));
  const setBlocks = (update: (blocks: SiteBlock[]) => SiteBlock[]) =>
    setDraft((d) => (d ? { ...d, blocks: update(d.blocks) } : d));
  const setBlockField = (index: number, key: string, value: string) =>
    setBlocks((blocks) => blocks.map((b, i) => (i === index ? ({ ...b, [key]: value } as SiteBlock) : b)));
  const itemsOf = (block: SiteBlock): Item[] =>
    block.type === 'features' || block.type === 'faq' ? (block.items as Item[]) : [];
  const setItems = (index: number, update: (items: Item[]) => Item[]) =>
    setBlocks((blocks) => blocks.map((b, i) => (i === index ? ({ ...b, items: update(itemsOf(b)) } as SiteBlock) : b)));
  const move = (index: number, by: number) =>
    setBlocks((blocks) => {
      const next = [...blocks];
      const [moved] = next.splice(index, 1);
      next.splice(index + by, 0, moved);
      return next;
    });

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!draft) return;
    const parsed = UpsertSitePageSchema.safeParse(
      clean({
        path: draft.path,
        locale: draft.locale,
        title: draft.title,
        description: draft.description,
        translationKey: draft.translationKey,
        status: draft.status,
        blocks: draft.blocks,
      }),
    );
    if (!parsed.success) {
      setError(t('site.manager.invalid'));
      return;
    }
    void run(async () => {
      const saved = await bffJson<SitePageDTO>(draft.id ? `${base}/${draft.id}` : base, {
        method: draft.id ? 'PUT' : 'POST',
        body: JSON.stringify(parsed.data),
      });
      setDraft({ ...saved, translationKey: saved.translationKey ?? '' });
      setNotice(t('site.manager.saved'));
    });
  };

  const remove = (page: SitePageDTO) =>
    run(async () => {
      await bffJson<void>(`${base}/${page.id}`, { method: 'DELETE' });
      if (draft?.id === page.id) setDraft(null);
      setNotice(t('site.manager.deleted'));
    });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="ui-title">{t('site.manager.title')}</h2>
          <p className="ui-text-muted">{t('site.manager.intro')}</p>
        </div>
        {canManage && !draft && <Button onClick={startNew}>{t('site.manager.new')}</Button>}
      </header>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="pui-alert pui-success">
          {notice}
        </p>
      )}

      {draft ? (
        <Card title={draft.id ? draft.title || draft.path : t('site.manager.new')} aria-label={t('site.manager.edit')}>
          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              label={t('site.field.path')}
              help={t('site.field.pathHelp')}
              value={draft.path}
              onChange={(e) => patch({ path: e.target.value })}
            />
            <TextField
              label={t('site.field.locale')}
              value={draft.locale}
              onChange={(e) => patch({ locale: e.target.value })}
            />
            <TextField
              label={t('site.field.title')}
              help={t('site.field.titleHelp', { count: draft.title.length })}
              maxLength={70}
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
            <TextField
              label={t('site.field.translationKey')}
              help={t('site.field.translationKeyHelp')}
              value={draft.translationKey}
              onChange={(e) => patch({ translationKey: e.target.value })}
            />
          </div>
          <TextAreaField
            label={t('site.field.description')}
            help={t('site.field.descriptionHelp', { count: draft.description.length })}
            maxLength={160}
            rows={2}
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
          <SelectField
            label={t('site.field.status')}
            value={draft.status}
            onChange={(e) => patch({ status: e.target.value as SitePageStatus })}
          >
            {SITE_PAGE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`site.status.${s}`)}
              </option>
            ))}
          </SelectField>

          <div className="flex flex-col gap-4 ui-rule pt-4">
            <h3 className="ui-heading">{t('site.blocks.title')}</h3>
            {draft.blocks.map((block, index) => (
              <fieldset
                key={index}
                className="flex flex-col gap-3 ui-rule pt-3"
                aria-label={t('site.blocks.position', { position: index + 1, type: t(`site.block.${block.type}`) })}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <legend className="ui-caption">
                    {t('site.blocks.position', { position: index + 1, type: t(`site.block.${block.type}`) })}
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" tone="muted" disabled={index === 0} onClick={() => move(index, -1)}>
                      {t('site.blocks.up')}
                    </Button>
                    <Button
                      variant="outline"
                      tone="muted"
                      disabled={index === draft.blocks.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      {t('site.blocks.down')}
                    </Button>
                    <Button
                      variant="outline"
                      tone="error"
                      disabled={draft.blocks.length === 1}
                      onClick={() => setBlocks((blocks) => blocks.filter((_, i) => i !== index))}
                    >
                      {t('site.blocks.remove')}
                    </Button>
                  </div>
                </div>
                <BlockFields
                  block={block}
                  areas={areas}
                  t={t}
                  onField={(key, value) => setBlockField(index, key, value)}
                  onItems={(update) => setItems(index, update)}
                />
              </fieldset>
            ))}
            <div className="flex flex-wrap gap-2">
              {SITE_BLOCK_TYPES.map((type) => (
                <Button
                  key={type}
                  variant="outline"
                  tone="muted"
                  disabled={draft.blocks.length >= 30 || (type === 'restaurants' && areas.length === 0)}
                  onClick={() => setBlocks((blocks) => [...blocks, emptyBlock(type, areas)])}
                >
                  {t('site.blocks.add')}: {t(`site.block.${type}`)}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 ui-rule pt-4">
            {canManage && (
              <Button onClick={save} disabled={busy}>
                {t('site.manager.save')}
              </Button>
            )}
            <Button variant="outline" tone="muted" onClick={() => setDraft(null)} disabled={busy}>
              {t('site.manager.cancel')}
            </Button>
          </div>
        </Card>
      ) : pages.length === 0 ? (
        <p className="ui-text-muted">{t('site.manager.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="pui-table w-full">
            <thead>
              <tr>
                <th scope="col">{t('site.manager.colPath')}</th>
                <th scope="col">{t('site.manager.colLocale')}</th>
                <th scope="col">{t('site.manager.colTitle')}</th>
                <th scope="col">{t('site.manager.colStatus')}</th>
                <th scope="col" aria-label={t('site.manager.edit')} />
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
                <tr key={page.id} data-site-page={`${page.locale}/${page.path}`}>
                  <td>{page.path}</td>
                  <td>{page.locale}</td>
                  <td>
                    <span className="flex flex-col">
                      <span>{page.title}</span>
                      <span className="ui-caption">{t('site.manager.updated', { date: when(page.updatedAt) })}</span>
                    </span>
                  </td>
                  <td>
                    <Badge tone={page.status === 'PUBLISHED' ? 'success' : 'muted'}>
                      {t(`site.status.${page.status}`)}
                    </Badge>
                  </td>
                  <td>
                    <div className="flex flex-wrap justify-end gap-2">
                      {page.status === 'PUBLISHED' && (
                        <a className="pui-btn pui-outline pui-muted" href={sitePagePath(page.locale, page.path)}>
                          {t('site.manager.open')}
                        </a>
                      )}
                      <Button variant="outline" tone="muted" onClick={() => startEdit(page)} disabled={busy}>
                        {t('site.manager.edit')}
                      </Button>
                      {canManage && (
                        <Button variant="outline" tone="error" onClick={() => remove(page)} disabled={busy}>
                          {t('site.manager.delete')}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BlockFields({
  block,
  areas,
  t,
  onField,
  onItems,
}: {
  block: SiteBlock;
  areas: MarketplaceAreaDTO[];
  t: ReturnType<typeof useT>;
  onField: (key: string, value: string) => void;
  onItems: (update: (items: Item[]) => Item[]) => void;
}) {
  const text = (key: string, value: string | undefined, help?: string) => (
    <TextField
      label={t(`site.blockField.${key}`)}
      help={help}
      value={value ?? ''}
      onChange={(e) => onField(key, e.target.value)}
    />
  );
  const long = (key: string, value: string | undefined) => (
    <TextAreaField
      label={t(`site.blockField.${key}`)}
      rows={4}
      value={value ?? ''}
      onChange={(e) => onField(key, e.target.value)}
    />
  );
  const items = (fields: { key: string; label: string; long?: boolean }[], list: Item[], blank: Item) => (
    <div className="flex flex-col gap-3">
      {list.map((item, i) => (
        <div key={i} className="flex flex-col gap-2">
          {fields.map(({ key, label, long: multiline }) =>
            !multiline ? (
              <TextField
                key={key}
                label={t(`site.blockField.${label}`)}
                value={item[key] ?? ''}
                onChange={(e) =>
                  onItems((all) => all.map((it, j) => (j === i ? { ...it, [key]: e.target.value } : it)))
                }
              />
            ) : (
              <TextAreaField
                key={key}
                label={t(`site.blockField.${label}`)}
                rows={3}
                value={item[key] ?? ''}
                onChange={(e) =>
                  onItems((all) => all.map((it, j) => (j === i ? { ...it, [key]: e.target.value } : it)))
                }
              />
            ),
          )}
          <div>
            <Button
              variant="outline"
              tone="error"
              disabled={list.length === 1}
              onClick={() => onItems((all) => all.filter((_, j) => j !== i))}
            >
              {t('site.blocks.removeItem')}
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button variant="outline" tone="muted" onClick={() => onItems((all) => [...all, { ...blank }])}>
          {t('site.blocks.addItem')}
        </Button>
      </div>
    </div>
  );

  switch (block.type) {
    case 'hero':
      return (
        <>
          {text('heading', block.heading)}
          {text('subheading', block.subheading)}
          <div className="grid gap-3 md:grid-cols-2">
            {text('ctaLabel', block.ctaLabel)}
            {text('ctaHref', block.ctaHref, t('site.blockField.hrefHelp'))}
          </div>
        </>
      );
    case 'text':
      return (
        <>
          {text('heading', block.heading)}
          {long('body', block.body)}
        </>
      );
    case 'features':
      return (
        <>
          {text('heading', block.heading)}
          {items(
            [
              { key: 'title', label: 'itemTitle' },
              { key: 'body', label: 'itemBody', long: true },
            ],
            block.items,
            { title: '', body: '' },
          )}
        </>
      );
    case 'faq':
      return (
        <>
          {text('heading', block.heading)}
          {items(
            [
              { key: 'question', label: 'question' },
              { key: 'answer', label: 'answer', long: true },
            ],
            block.items,
            { question: '', answer: '' },
          )}
        </>
      );
    case 'cta':
      return (
        <>
          {text('heading', block.heading)}
          {long('body', block.body)}
          <div className="grid gap-3 md:grid-cols-2">
            {text('label', block.label)}
            {text('href', block.href, t('site.blockField.hrefHelp'))}
          </div>
        </>
      );
    case 'restaurants':
      return (
        <>
          {text('heading', block.heading)}
          <SelectField
            label={t('site.blockField.area')}
            help={t('site.blockField.areaHelp')}
            value={block.area}
            onChange={(e) => onField('area', e.target.value)}
          >
            {areas.map((a) => (
              <option key={areaKey(a)} value={areaKey(a)}>
                {a.city} / {a.district}
              </option>
            ))}
          </SelectField>
        </>
      );
  }
}
