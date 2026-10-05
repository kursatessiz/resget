'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { INSTAGRAM_HASHTAG_MAX, SOCIAL_POST_BODY_MAX, socialPostProblems } from '@resget/shared';
import type {
  SocialAccountDTO,
  SocialPostDTO,
  SocialPostPageDTO,
  SocialPostStatus,
  SocialTargetStatus,
} from '@resget/shared';
import { Badge, Button, Card, TextAreaField, TextField } from '@/components/ui';
import type { UiTone } from '@/components/ui';
import { ApiError, bffJson, bffUpload } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const POST_TONE: Record<SocialPostStatus, UiTone> = {
  DRAFT: 'muted',
  SCHEDULED: 'theme',
  PUBLISHING: 'theme',
  PUBLISHED: 'success',
  PARTIAL: 'warn',
  FAILED: 'error',
};
const TARGET_TONE: Record<SocialTargetStatus, UiTone> = { PENDING: 'muted', PUBLISHED: 'success', FAILED: 'error' };

/**
 * Social publishing (docs/SOSYAL_YAYIN.md): write a post, pick the connected
 * accounts, add an image (required for Instagram), then save it as a draft,
 * schedule it or publish it now. Each account's outcome is listed under the
 * post. Post text is shown as plain text.
 */
export function SocialPublisher({
  restaurantId,
  locale,
  canManage,
  integrationsHref,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
  /** Where accounts are connected, for the empty state. */
  integrationsHref: string;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/social/posts`;
  const [accounts, setAccounts] = useState<SocialAccountDTO[] | null>(null);
  const [data, setData] = useState<SocialPostPageDTO | null>(null);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<SocialPostDTO | null>(null);
  const [body, setBody] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [scheduleAt, setScheduleAt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const loadPosts = useCallback(
    () => bffJson<SocialPostPageDTO>(`${base}?page=${page}`).then(setData).catch(fail),
    [base, page, fail],
  );
  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);
  useEffect(() => {
    if (!canManage) return;
    bffJson<SocialAccountDTO[]>(`${base}/accounts`)
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, [base, canManage]);

  const kinds = useMemo(
    () => (accounts ?? []).filter((a) => selected.includes(a.id)).map((a) => a.kind),
    [accounts, selected],
  );
  const problems = socialPostProblems({ body, hasImage: Boolean(editing?.imageUrl), kinds });
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

  const reset = () => {
    setEditing(null);
    setBody('');
    setSelected([]);
    setScheduleAt('');
    setFile(null);
  };
  const startEdit = (post: SocialPostDTO) => {
    setEditing(post);
    setBody(post.body);
    setSelected(post.targets.map((target) => target.accountId).filter((id): id is string => id !== null));
    setScheduleAt('');
    setFile(null);
    setError(null);
  };
  const run = async (action: () => Promise<SocialPostDTO | void>, after: 'keep' | 'reset' = 'keep') => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (after === 'reset') reset();
      else if (result) setEditing(result);
      await loadPosts();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  /** Creates or updates the draft from the form and returns it. */
  const save = async (): Promise<SocialPostDTO> => {
    const payload = JSON.stringify({ body, accountIds: selected });
    return editing
      ? bffJson<SocialPostDTO>(`${base}/${editing.id}`, { method: 'PATCH', body: payload })
      : bffJson<SocialPostDTO>(base, { method: 'POST', body: payload });
  };
  const uploadImage = () =>
    run(async () => {
      if (!editing || !file) return;
      const form = new FormData();
      form.append('file', file);
      const updated = await bffUpload<SocialPostDTO>(`${base}/${editing.id}/image`, form);
      setFile(null);
      return updated;
    });
  const schedule = () => {
    if (!scheduleAt) {
      setError(t('socialPublishing.scheduleRequired'));
      return;
    }
    void run(async () => {
      const draft = await save();
      await bffJson<SocialPostDTO>(`${base}/${draft.id}/schedule`, {
        method: 'POST',
        body: JSON.stringify({ scheduledAt: new Date(scheduleAt).toISOString() }),
      });
    }, 'reset');
  };
  const publishNow = () =>
    run(async () => {
      const draft = await save();
      await bffJson<SocialPostDTO>(`${base}/${draft.id}/publish`, { method: 'POST' });
    }, 'reset');

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const canSubmit = !busy && body.trim().length > 0 && selected.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('socialPublishing.title')}</h1>
        <p className="ui-text-muted">{t('socialPublishing.intro')}</p>
      </header>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}

      {canManage && (
        <Card
          title={editing ? t('socialPublishing.edit') : t('socialPublishing.compose')}
          aria-label={t('socialPublishing.compose')}
        >
          {accounts && accounts.length === 0 ? (
            <p className="ui-caption">
              <a className="pui-btn pui-link pui-theme" href={integrationsHref}>
                {t('socialPublishing.noAccounts')}
              </a>
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <TextAreaField
                label={t('socialPublishing.body')}
                help={t('socialPublishing.bodyHelp', { max: SOCIAL_POST_BODY_MAX, hashtags: INSTAGRAM_HASHTAG_MAX })}
                value={body}
                maxLength={SOCIAL_POST_BODY_MAX}
                rows={5}
                onChange={(e) => setBody(e.target.value)}
              />
              <span className="ui-caption">
                {t('socialPublishing.characters', { count: body.length, max: SOCIAL_POST_BODY_MAX })}
              </span>
              <fieldset className="flex flex-col gap-2">
                <legend className="ui-label">{t('socialPublishing.accounts')}</legend>
                {(accounts ?? []).map((account) => (
                  <label key={account.id} className="flex items-center gap-2" data-post-account={account.externalId}>
                    <input
                      type="checkbox"
                      className="pui-checkbox"
                      checked={selected.includes(account.id)}
                      onChange={(e) =>
                        setSelected((current) =>
                          e.target.checked ? [...current, account.id] : current.filter((id) => id !== account.id),
                        )
                      }
                    />
                    <span>
                      {account.name} <span className="ui-caption">{t(`social.kind.${account.kind}`)}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="flex flex-col gap-2">
                <span className="ui-label">{t('socialPublishing.image')}</span>
                <span className="ui-caption">{t('socialPublishing.imageHelp')}</span>
                {editing ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {editing.imageUrl && (
                      <>
                        <Badge tone="success">{t('socialPublishing.withImage')}</Badge>
                        <Button
                          variant="outline"
                          tone="error"
                          disabled={busy}
                          onClick={() =>
                            void run(() => bffJson<SocialPostDTO>(`${base}/${editing.id}/image`, { method: 'DELETE' }))
                          }
                        >
                          {t('socialPublishing.imageRemove')}
                        </Button>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      aria-label={t('socialPublishing.image')}
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                    <Button variant="outline" tone="muted" disabled={busy || !file} onClick={() => void uploadImage()}>
                      {t('socialPublishing.imageUpload')}
                    </Button>
                  </div>
                ) : (
                  <span className="ui-caption">{t('socialPublishing.imageAfterSave')}</span>
                )}
              </div>
              {problems.length > 0 && (
                <ul className="flex flex-col gap-1" aria-live="polite">
                  {problems.map((problem) => (
                    <li key={problem} className="pui-alert pui-warn" data-post-problem={problem}>
                      {t(`socialPublishing.problem.${problem}`)}
                    </li>
                  ))}
                </ul>
              )}
              <TextField
                type="datetime-local"
                label={t('socialPublishing.scheduleAt')}
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" tone="muted" disabled={!canSubmit} onClick={() => void run(() => save())}>
                  {t('socialPublishing.saveDraft')}
                </Button>
                <Button variant="outline" disabled={!canSubmit || problems.length > 0} onClick={schedule}>
                  {t('socialPublishing.schedule')}
                </Button>
                <Button disabled={!canSubmit || problems.length > 0} onClick={() => void publishNow()}>
                  {t('socialPublishing.publishNow')}
                </Button>
                {editing && (
                  <Button variant="outline" tone="muted" disabled={busy} onClick={reset}>
                    {t('socialPublishing.cancelEdit')}
                  </Button>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      <Card title={t('socialPublishing.list')} aria-label={t('socialPublishing.list')}>
        {data && data.items.length === 0 && <p className="ui-caption">{t('socialPublishing.empty')}</p>}
        {data && data.items.length > 0 && (
          <ul className="flex flex-col ui-divide">
            {data.items.map((post) => (
              <li key={post.id} className="flex flex-col gap-2 py-3" data-post={post.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={POST_TONE[post.status]}>{t(`socialPublishing.status.${post.status}`)}</Badge>
                  {post.imageUrl && <span className="ui-caption">{t('socialPublishing.withImage')}</span>}
                  {post.scheduledAt && post.status === 'SCHEDULED' && (
                    <span className="ui-caption">
                      {t('socialPublishing.scheduledFor', { date: when(post.scheduledAt) })}
                    </span>
                  )}
                  {post.publishedAt && (
                    <span className="ui-caption">
                      {t('socialPublishing.publishedAt', { date: when(post.publishedAt) })}
                    </span>
                  )}
                  {post.createdBy && (
                    <span className="ui-caption">{t('socialPublishing.createdBy', { name: post.createdBy })}</span>
                  )}
                </div>
                <p>{post.body}</p>
                <ul className="flex flex-col gap-1">
                  {post.targets.map((target) => (
                    <li
                      key={`${post.id}-${target.accountName}-${target.kind}`}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <span>{target.accountName}</span>
                      <span className="ui-caption">{t(`social.kind.${target.kind}`)}</span>
                      <Badge tone={TARGET_TONE[target.status]}>{t(`socialPublishing.target.${target.status}`)}</Badge>
                      {target.reason && (
                        <span className="ui-caption">{t(`socialPublishing.reason.${target.reason}`)}</span>
                      )}
                    </li>
                  ))}
                </ul>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    {post.editable && (
                      <Button variant="outline" tone="muted" disabled={busy} onClick={() => startEdit(post)}>
                        {t('socialPublishing.editAction')}
                      </Button>
                    )}
                    {post.editable && post.status === 'SCHEDULED' && (
                      <Button
                        variant="outline"
                        tone="muted"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => bffJson<SocialPostDTO>(`${base}/${post.id}/unschedule`, { method: 'POST' }),
                            'reset',
                          )
                        }
                      >
                        {t('socialPublishing.unschedule')}
                      </Button>
                    )}
                    {(post.editable || post.status === 'FAILED') && (
                      <Button
                        variant="outline"
                        tone="error"
                        disabled={busy}
                        onClick={() =>
                          void run(() => bffJson<void>(`${base}/${post.id}`, { method: 'DELETE' }), 'reset')
                        }
                      >
                        {t('socialPublishing.delete')}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {data && pages > 1 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" tone="muted" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t('socialPublishing.previous')}
            </Button>
            <span className="ui-caption">{t('socialPublishing.pagination', { page, pages })}</span>
            <Button variant="outline" tone="muted" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              {t('socialPublishing.next')}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
