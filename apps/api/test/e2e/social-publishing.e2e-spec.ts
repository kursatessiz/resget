import './support/meta-mock';
import type { OAuthStartDTO, SocialAccountDTO, SocialPostDTO, SocialPostPageDTO } from '@resget/shared';
import { SocialPublishingService } from '../../src/modules/social-publishing/social-publishing.service';
import { META_GRAPH, MockMetaGraph } from '../../src/modules/social/meta-graph';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const HOUR = 3_600_000;

/** Social publishing (docs/SOSYAL_YAYIN.md): drafts, rules, images, scheduling, per-account outcomes and retries. */
describe('Social publishing (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let page: SocialAccountDTO;
  let instagram: SocialAccountDTO;
  let service: SocialPublishingService;
  let meta: MockMetaGraph;
  const owner = () => bearer(ownerToken, restaurantId);
  const base = () => `/restaurants/${restaurantId}/social/posts`;
  const create = async (body: string, accountIds: string[]) =>
    (await ctx.http().post(base()).set(owner()).send({ body, accountIds }).expect(201)).body as SocialPostDTO;
  const attachImage = async (postId: string) =>
    (await ctx.http().post(`${base()}/${postId}/image`).set(owner()).attach('file', PNG_1X1, 'post.png').expect(200))
      .body as SocialPostDTO;
  const setAccount = (id: string, enabled: boolean) =>
    ctx.http().patch(`/restaurants/${restaurantId}/social/accounts/${id}`).set(owner()).send({ enabled }).expect(200);
  const post = (id: string) =>
    ctx.prisma.socialPost.findUniqueOrThrow({ where: { id }, include: { targets: { orderBy: { kind: 'asc' } } } });

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    restaurantId = (
      await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug }, select: { id: true } })
    ).id;
    service = ctx.app.get(SocialPublishingService);
    meta = ctx.app.get<MockMetaGraph>(META_GRAPH);
    await ctx.prisma.socialPost.deleteMany({ where: { restaurantId } });
    await ctx.prisma.socialAccount.deleteMany({ where: { restaurantId } });
  });

  afterAll(async () => {
    await ctx.prisma.socialPost.deleteMany({ where: { restaurantId } });
    await ctx.prisma.socialAccount.deleteMany({ where: { restaurantId } });
    await ctx.prisma.oAuthState.deleteMany({ where: { restaurantId } });
    await ctx.prisma.featureFlag.deleteMany({
      where: { restaurantId, key: { in: ['integration_hub', 'social_publishing'] } },
    });
    await ctx.prisma.auditLog.deleteMany({ where: { restaurantId, action: { startsWith: 'social.' } } });
    await ctx.close();
  });

  it('is behind its switch', async () => {
    await ctx.http().get(base()).set(owner()).expect(403).expect('x-error-code', 'FEATURE_DISABLED');
    for (const key of ['integration_hub', 'social_publishing']) {
      await ctx
        .http()
        .put(`/admin/restaurants/${restaurantId}/features/${key}`)
        .set(bearer(adminToken))
        .send({ enabled: true })
        .expect(200);
    }
    const start = (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/social/meta/connect`)
        .set(owner())
        .send({ returnPath: `/panel/${SEED.restaurantSlug}/entegrasyon` })
        .expect(200)
    ).body as OAuthStartDTO;
    const url = new URL(start.authorizeUrl);
    await ctx.http().get(`${url.pathname}${url.search}`).expect(302);
    const accounts = (await ctx.http().get(`/restaurants/${restaurantId}/social/accounts`).set(owner()).expect(200))
      .body as SocialAccountDTO[];
    page = accounts.find((a) => a.kind === 'FACEBOOK_PAGE') as SocialAccountDTO;
    instagram = accounts.find((a) => a.kind === 'INSTAGRAM_BUSINESS') as SocialAccountDTO;
  });

  it('only takes accounts that are in use', async () => {
    await ctx
      .http()
      .post(base())
      .set(owner())
      .send({ body: 'Merhaba', accountIds: [page.id] })
      .expect(400)
      .expect('x-error-code', 'SOCIAL_ACCOUNT_UNAVAILABLE');
    await setAccount(page.id, true);
    await setAccount(instagram.id, true);
    const usable = (await ctx.http().get(`${base()}/accounts`).set(owner()).expect(200)).body as SocialAccountDTO[];
    expect(usable.map((a) => a.id).sort()).toEqual([page.id, instagram.id].sort());
  });

  it('asks for an image for Instagram, then publishes a scheduled post to every account', async () => {
    const draft = await create('Bu hafta sonu yeni menu #lezzet', [page.id, instagram.id]);
    expect(draft).toMatchObject({ status: 'DRAFT', editable: true, problems: ['INSTAGRAM_NEEDS_IMAGE'] });
    await ctx
      .http()
      .post(`${base()}/${draft.id}/publish`)
      .set(owner())
      .expect(400)
      .expect('x-error-code', 'SOCIAL_POST_INVALID');

    const withImage = await attachImage(draft.id);
    expect(withImage.problems).toEqual([]);
    const imageUrl = new URL(withImage.imageUrl as string);
    expect(imageUrl.pathname).toMatch(/^\/uploads\/social\/[0-9a-f-]{36}\.png$/);
    const served = await ctx.http().get(imageUrl.pathname).expect(200).expect('content-type', 'image/png');
    expect(Buffer.compare(served.body as Buffer, PNG_1X1)).toBe(0);
    await ctx
      .http()
      .get(imageUrl.pathname.replace(/\.png$/, '.jpg'))
      .expect(404);
    await ctx.http().get('/uploads/social/..%2F..%2Fetc%2Fpasswd').expect(404);

    await ctx
      .http()
      .post(`${base()}/${draft.id}/schedule`)
      .set(owner())
      .send({ scheduledAt: new Date(Date.now() - 1000).toISOString() })
      .expect(400)
      .expect('x-error-code', 'SOCIAL_SCHEDULE_INVALID');
    const at = new Date(Date.now() + HOUR);
    const scheduled = (
      await ctx
        .http()
        .post(`${base()}/${draft.id}/schedule`)
        .set(owner())
        .send({ scheduledAt: at.toISOString() })
        .expect(200)
    ).body as SocialPostDTO;
    expect(scheduled).toMatchObject({ status: 'SCHEDULED', scheduledAt: at.toISOString() });

    const before = meta.published.length;
    await service.sweep(new Date());
    expect((await post(draft.id)).status).toBe('SCHEDULED');
    await service.sweep(new Date(Date.now() + 2 * HOUR));
    const done = await post(draft.id);
    expect(done.status).toBe('PUBLISHED');
    expect(done.publishedAt).not.toBeNull();
    expect(done.targets.map((t) => t.status)).toEqual(['PUBLISHED', 'PUBLISHED']);
    expect(done.targets.every((t) => t.externalPostId?.startsWith('mock-post-'))).toBe(true);
    const sent = meta.published.slice(before);
    expect(sent.map((s) => s.accountId).sort()).toEqual(['mock-ig-1', 'mock-page-1']);
    expect(
      sent.every((s) => s.imageUrl === withImage.imageUrl && s.message === 'Bu hafta sonu yeni menu #lezzet'),
    ).toBe(true);

    await ctx
      .http()
      .patch(`${base()}/${draft.id}`)
      .set(owner())
      .send({ body: 'Degisti', accountIds: [page.id] })
      .expect(409)
      .expect('x-error-code', 'SOCIAL_POST_LOCKED');
    await ctx.http().delete(`${base()}/${draft.id}`).set(owner()).expect(409);
    // Nothing runs it twice.
    await service.sweep(new Date(Date.now() + 3 * HOUR));
    expect(meta.published.length).toBe(before + 2);
  });

  it('keeps what went out when one account is no longer available', async () => {
    const draft = await create('Kampanya basladi', [page.id, instagram.id]);
    await attachImage(draft.id);
    await setAccount(instagram.id, false);
    const res = (await ctx.http().post(`${base()}/${draft.id}/publish`).set(owner()).expect(200)).body as SocialPostDTO;
    expect(res.status).toBe('PARTIAL');
    const byKind = Object.fromEntries(res.targets.map((t) => [t.kind, t]));
    expect(byKind.FACEBOOK_PAGE).toMatchObject({ status: 'PUBLISHED' });
    expect(byKind.INSTAGRAM_BUSINESS).toMatchObject({ status: 'FAILED', reason: 'ACCOUNT_UNAVAILABLE', attempts: 1 });
    await setAccount(instagram.id, true);
  });

  it('retries a refused account a few times, locks the post meanwhile and lets a failed one go', async () => {
    const draft = await create('Bu gonderi #fail olur', [page.id]);
    const first = (await ctx.http().post(`${base()}/${draft.id}/publish`).set(owner()).expect(200))
      .body as SocialPostDTO;
    expect(first).toMatchObject({ status: 'SCHEDULED', editable: false });
    expect(first.targets[0]).toMatchObject({ status: 'PENDING', attempts: 1, reason: 'GRAPH_ERROR' });
    await ctx
      .http()
      .patch(`${base()}/${draft.id}`)
      .set(owner())
      .send({ body: 'Duzelttim', accountIds: [page.id] })
      .expect(409);
    await ctx.http().delete(`${base()}/${draft.id}`).set(owner()).expect(409);

    await service.sweep(new Date(Date.now() + 10 * 60_000));
    expect((await post(draft.id)).targets[0].attempts).toBe(2);
    await service.sweep(new Date(Date.now() + 20 * 60_000));
    const failed = await post(draft.id);
    expect(failed.status).toBe('FAILED');
    expect(failed.targets[0]).toMatchObject({ status: 'FAILED', attempts: 3 });
    await ctx.http().delete(`${base()}/${draft.id}`).set(owner()).expect(204);
  });

  it('serves an image only while a post points at it and lists posts newest first', async () => {
    const draft = await create('Gorselli taslak', [page.id]);
    const withImage = await attachImage(draft.id);
    const path = new URL(withImage.imageUrl as string).pathname;
    await ctx.http().get(path).expect(200);
    const cleared = (await ctx.http().delete(`${base()}/${draft.id}/image`).set(owner()).expect(200))
      .body as SocialPostDTO;
    expect(cleared.imageUrl).toBeNull();
    await ctx.http().get(path).expect(404);

    const list = (await ctx.http().get(base()).set(owner()).expect(200)).body as SocialPostPageDTO;
    expect(list.items[0].id).toBe(draft.id);
    expect(list.items.map((p) => p.status)).toEqual(expect.arrayContaining(['PUBLISHED', 'PARTIAL', 'DRAFT']));

    await ctx.http().delete(`${base()}/${draft.id}`).set(owner()).expect(204);
    expect(await ctx.prisma.auditLog.count({ where: { restaurantId, action: 'social.post.publish' } })).toBe(2);
  });
});
