import { Inject, Injectable, Logger, Optional, StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@resget/database';
import {
  EDITABLE_SOCIAL_POST_STATUSES,
  SOCIAL_IMAGE_MAX_BYTES,
  SOCIAL_POSTS_PAGE_SIZE,
  SOCIAL_PUBLISH_MAX_ATTEMPTS,
  SOCIAL_PUBLISH_RETRY_MINUTES,
  SOCIAL_SCHEDULE_MAX_DAYS,
  socialPostProblems,
} from '@resget/shared';
import type {
  SocialAccountDTO,
  SocialAccountKind,
  SocialPostDTO,
  SocialPostInput,
  SocialPostPageDTO,
  SocialPostStatus,
  SocialTargetReason,
  SocialTargetStatus,
} from '@resget/shared';
import { badRequest, conflict, notFound } from '../../common/api-error';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { META_GRAPH } from '../social/meta-graph';
import type { MetaGraph } from '../social/meta-graph';
import { SocialService } from '../social/social.service';
import { sniffImage } from '../uploads/uploads.service';
import type { UploadedImage } from '../uploads/uploads.service';

/** How long a publishing run holds a post; a lease older than this belongs to a crashed run. */
const LEASE_MS = 5 * 60_000;
/** Posts the sweep publishes per run. */
const SWEEP_BATCH = 20;
const MIN_LEAD_MS = 60_000;
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;
const IMAGE_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|webp)$/;

const postInclude = {
  targets: { orderBy: { accountName: 'asc' } },
  createdBy: { select: { fullName: true } },
} satisfies Prisma.SocialPostInclude;

type PostRow = Prisma.SocialPostGetPayload<{ include: typeof postInclude }>;

/**
 * A post can change only before any run touched it: once one account was
 * tried, editing would publish the changed post next to the one already out.
 */
const isEditable = (row: { status: string; targets: ReadonlyArray<{ attempts: number }> }) =>
  (EDITABLE_SOCIAL_POST_STATUSES as readonly string[]).includes(row.status) &&
  row.targets.every((t) => t.attempts === 0);

/**
 * Social publishing (docs/SOSYAL_YAYIN.md). Posts are drafts until
 * scheduled or published; a run leases the post, publishes to each pending
 * account through the Meta Graph API with that account's page token, and
 * settles the post from its targets. A failed account is tried again a few
 * times before it counts as failed; the accounts that went out stay out.
 */
@Injectable()
export class SocialPublishingService {
  private readonly logger = new Logger(SocialPublishingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
    private readonly social: SocialService,
    private readonly config: ConfigService,
    @Optional() @Inject(META_GRAPH) private readonly meta: MetaGraph | null,
  ) {}

  // -- Drafts ----------------------------------------------------------------------------

  async list(restaurantId: string, page: number): Promise<SocialPostPageDTO> {
    const [rows, total] = await Promise.all([
      this.prisma.socialPost.findMany({
        where: { restaurantId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * SOCIAL_POSTS_PAGE_SIZE,
        take: SOCIAL_POSTS_PAGE_SIZE,
        include: postInclude,
      }),
      this.prisma.socialPost.count({ where: { restaurantId } }),
    ]);
    return { items: rows.map((row) => toDto(row)), total, page, pageSize: SOCIAL_POSTS_PAGE_SIZE };
  }

  async publishableAccounts(restaurantId: string): Promise<SocialAccountDTO[]> {
    return (await this.social.list(restaurantId)).filter((a) => a.enabled && a.status === 'ACTIVE');
  }

  async create(restaurantId: string, userId: string, input: SocialPostInput): Promise<SocialPostDTO> {
    const accounts = await this.accounts(restaurantId, input.accountIds);
    const row = await this.prisma.socialPost.create({
      data: {
        restaurantId,
        createdByUserId: userId,
        body: input.body,
        targets: {
          create: accounts.map((a) => ({ socialAccountId: a.id, accountName: a.name, kind: a.kind })),
        },
      },
      include: postInclude,
    });
    await this.audit(restaurantId, userId, 'social.post.create', row.id);
    return toDto(row);
  }

  /** Edits the text and accounts; a scheduled post keeps its time only if it still meets the rules. */
  async update(restaurantId: string, postId: string, userId: string, input: SocialPostInput): Promise<SocialPostDTO> {
    const post = await this.editable(restaurantId, postId);
    const accounts = await this.accounts(restaurantId, input.accountIds);
    const problems = socialPostProblems({
      body: input.body,
      hasImage: post.imageUrl !== null,
      kinds: accounts.map((a) => a.kind as SocialAccountKind),
    });
    await this.prisma.$transaction([
      this.prisma.socialPostTarget.deleteMany({ where: { postId } }),
      this.prisma.socialPost.update({
        where: { id: postId },
        data: {
          body: input.body,
          // A scheduled post that no longer fits its accounts goes back to draft rather than failing later.
          ...(post.status === 'SCHEDULED' && problems.length > 0 ? { status: 'DRAFT', scheduledAt: null } : {}),
          targets: {
            create: accounts.map((a) => ({ socialAccountId: a.id, accountName: a.name, kind: a.kind })),
          },
        },
      }),
    ]);
    await this.audit(restaurantId, userId, 'social.post.update', postId);
    return this.get(restaurantId, postId);
  }

  async remove(restaurantId: string, postId: string, userId: string): Promise<void> {
    const post = await this.require(restaurantId, postId);
    // What went out stays on record; deleting here would not take it off the accounts anyway.
    if (!isEditable(post) && post.status !== 'FAILED') {
      throw conflict('SOCIAL_POST_LOCKED', 'A published or running post stays on record');
    }
    // The image row goes with the post (cascade).
    await this.prisma.socialPost.delete({ where: { id: post.id } });
    await this.audit(restaurantId, userId, 'social.post.delete', post.id);
  }

  async setImage(restaurantId: string, postId: string, file: UploadedImage | undefined): Promise<SocialPostDTO> {
    const post = await this.editable(restaurantId, postId);
    if (!file || file.size === 0) throw badRequest('UNSUPPORTED_FILE', 'No file received');
    if (file.size > SOCIAL_IMAGE_MAX_BYTES) throw badRequest('FILE_TOO_LARGE', 'Image exceeds the size limit');
    // The kind is read from the bytes, never from the client's file name or declared type.
    const kind = sniffImage(file.buffer);
    if (!kind) throw badRequest('UNSUPPORTED_FILE', 'Only PNG, JPEG and WebP images are accepted');
    // A new row (and so a new id and address) per image: the address is cached as immutable.
    await this.prisma.$transaction(async (tx) => {
      await tx.socialPostImage.deleteMany({ where: { postId: post.id } });
      const image = await tx.socialPostImage.create({
        data: { postId: post.id, contentType: IMAGE_TYPES[kind], data: new Uint8Array(file.buffer) },
        select: { id: true },
      });
      await tx.socialPost.update({
        where: { id: post.id },
        data: { imageUrl: `${this.publicApiUrl()}/uploads/social/${image.id}.${kind}` },
      });
    });
    return this.get(restaurantId, postId);
  }

  async removeImage(restaurantId: string, postId: string): Promise<SocialPostDTO> {
    const post = await this.editable(restaurantId, postId);
    const kinds = post.targets.map((t) => t.kind as SocialAccountKind);
    const stillFits = socialPostProblems({ body: post.body, hasImage: false, kinds }).length === 0;
    await this.prisma.$transaction([
      this.prisma.socialPostImage.deleteMany({ where: { postId: post.id } }),
      this.prisma.socialPost.update({
        where: { id: post.id },
        data: {
          imageUrl: null,
          ...(post.status === 'SCHEDULED' && !stillFits ? { status: 'DRAFT', scheduledAt: null } : {}),
        },
      }),
    ]);
    return this.get(restaurantId, postId);
  }

  /**
   * Serves a post image by its random id; public, because Meta fetches it
   * for Instagram. The stored type is sent, not one derived from the
   * request, and a removed or replaced image is a 404.
   */
  async openImage(file: string): Promise<StreamableFile> {
    const match = IMAGE_FILE.exec(file);
    if (!match) throw notFound('NOT_FOUND', 'File not found');
    const image = await this.prisma.socialPostImage.findUnique({
      where: { id: match[1] },
      select: { contentType: true, data: true },
    });
    if (!image || image.contentType !== IMAGE_TYPES[match[2] as keyof typeof IMAGE_TYPES]) {
      throw notFound('NOT_FOUND', 'File not found');
    }
    return new StreamableFile(Buffer.from(image.data), { type: image.contentType, length: image.data.length });
  }

  private publicApiUrl(): string {
    return this.config.getOrThrow<string>('PUBLIC_API_URL').replace(/\/+$/, '');
  }

  // -- Scheduling and publishing ---------------------------------------------------------

  async schedule(
    restaurantId: string,
    postId: string,
    userId: string,
    scheduledAt: Date,
    now = new Date(),
  ): Promise<SocialPostDTO> {
    const post = await this.editable(restaurantId, postId);
    if (
      scheduledAt.getTime() < now.getTime() + MIN_LEAD_MS ||
      scheduledAt.getTime() > now.getTime() + SOCIAL_SCHEDULE_MAX_DAYS * 86_400_000
    ) {
      throw badRequest('SOCIAL_SCHEDULE_INVALID', 'The time is too soon or too far ahead');
    }
    this.assertPublishable(post);
    await this.prisma.socialPost.update({ where: { id: post.id }, data: { status: 'SCHEDULED', scheduledAt } });
    await this.audit(restaurantId, userId, 'social.post.schedule', post.id, { scheduledAt: scheduledAt.toISOString() });
    return this.get(restaurantId, postId);
  }

  async unschedule(restaurantId: string, postId: string, userId: string): Promise<SocialPostDTO> {
    const post = await this.editable(restaurantId, postId);
    await this.prisma.socialPost.update({ where: { id: post.id }, data: { status: 'DRAFT', scheduledAt: null } });
    await this.audit(restaurantId, userId, 'social.post.unschedule', post.id);
    return this.get(restaurantId, postId);
  }

  /** Publishes at once: the post is scheduled for now and run in this request. */
  async publishNow(restaurantId: string, postId: string, userId: string, now = new Date()): Promise<SocialPostDTO> {
    const post = await this.editable(restaurantId, postId);
    this.assertPublishable(post);
    await this.prisma.socialPost.update({ where: { id: post.id }, data: { status: 'SCHEDULED', scheduledAt: now } });
    await this.audit(restaurantId, userId, 'social.post.publish', post.id);
    await this.run(post.id, now);
    return this.get(restaurantId, postId);
  }

  /** Runs the posts whose time has come and takes over runs whose lease ran out; the watchdog calls it. */
  async sweep(now = new Date()): Promise<number> {
    await this.prisma.socialPost.updateMany({
      where: { status: 'PUBLISHING', leaseUntil: { lt: now } },
      data: { status: 'SCHEDULED', leaseUntil: null },
    });
    const due = await this.prisma.socialPost.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
      orderBy: { scheduledAt: 'asc' },
      take: SWEEP_BATCH,
      select: { id: true },
    });
    let ran = 0;
    for (const row of due) if (await this.run(row.id, now)) ran += 1;
    return ran;
  }

  /**
   * One publishing run. The post is leased atomically, so the request and
   * the sweep never publish it twice; each pending account is published and
   * the post settles from its targets.
   */
  async run(postId: string, now = new Date()): Promise<SocialPostStatus | null> {
    const claimed = await this.prisma.socialPost.updateMany({
      where: { id: postId, status: 'SCHEDULED', scheduledAt: { lte: now } },
      data: { status: 'PUBLISHING', leaseUntil: new Date(now.getTime() + LEASE_MS) },
    });
    if (claimed.count === 0) return null;
    const post = await this.prisma.socialPost.findUniqueOrThrow({
      where: { id: postId },
      include: { targets: { include: { socialAccount: true } } },
    });
    const moduleOn = await this.moduleOn(post.restaurantId);
    for (const target of post.targets) {
      if (target.status !== 'PENDING') continue;
      const outcome = await this.publishTarget(post, target, moduleOn);
      const attempts = target.attempts + 1;
      if (outcome.externalPostId) {
        await this.prisma.socialPostTarget.update({
          where: { id: target.id },
          data: {
            status: 'PUBLISHED',
            externalPostId: outcome.externalPostId,
            attempts,
            reason: null,
            publishedAt: now,
          },
        });
        continue;
      }
      // An account that is gone or a module that is off will not come back by retrying.
      const final = outcome.reason !== 'GRAPH_ERROR' || attempts >= SOCIAL_PUBLISH_MAX_ATTEMPTS;
      await this.prisma.socialPostTarget.update({
        where: { id: target.id },
        data: { status: final ? 'FAILED' : 'PENDING', attempts, reason: outcome.reason },
      });
    }

    const targets = await this.prisma.socialPostTarget.findMany({ where: { postId }, select: { status: true } });
    const statuses = targets.map((t) => t.status as SocialTargetStatus);
    const published = statuses.filter((s) => s === 'PUBLISHED').length;
    let status: SocialPostStatus;
    if (statuses.includes('PENDING')) status = 'SCHEDULED';
    else if (published === statuses.length) status = 'PUBLISHED';
    else status = published > 0 ? 'PARTIAL' : 'FAILED';
    await this.prisma.socialPost.update({
      where: { id: postId },
      data: {
        status,
        leaseUntil: null,
        ...(status === 'SCHEDULED'
          ? { scheduledAt: new Date(now.getTime() + SOCIAL_PUBLISH_RETRY_MINUTES * 60_000) }
          : {}),
        ...(published > 0 && !post.publishedAt ? { publishedAt: now } : {}),
      },
    });
    return status;
  }

  private async publishTarget(
    post: { body: string; imageUrl: string | null },
    target: {
      kind: string;
      socialAccount: { enabled: boolean; status: string; externalId: string; encryptedToken: string } | null;
    },
    moduleOn: boolean,
  ): Promise<{ externalPostId: string | null; reason: SocialTargetReason | null }> {
    if (!moduleOn) return { externalPostId: null, reason: 'MODULE_OFF' };
    const account = target.socialAccount;
    if (!account || !account.enabled || account.status !== 'ACTIVE' || !this.meta) {
      return { externalPostId: null, reason: 'ACCOUNT_UNAVAILABLE' };
    }
    try {
      const token = this.social.tokenOf(account);
      const content = { message: post.body, imageUrl: post.imageUrl };
      const externalPostId =
        target.kind === 'INSTAGRAM_BUSINESS' && post.imageUrl
          ? await this.meta.publishInstagram(account.externalId, token, { ...content, imageUrl: post.imageUrl })
          : await this.meta.publishPage(account.externalId, token, content);
      return { externalPostId, reason: null };
    } catch (error) {
      this.logger.warn(`Social publish failed: ${error instanceof Error ? error.message : 'error'}`);
      return { externalPostId: null, reason: 'GRAPH_ERROR' };
    }
  }

  // -- Helpers ---------------------------------------------------------------------------

  private async get(restaurantId: string, postId: string): Promise<SocialPostDTO> {
    return toDto(await this.require(restaurantId, postId));
  }

  private async require(restaurantId: string, postId: string): Promise<PostRow> {
    const row = await this.prisma.socialPost.findFirst({ where: { id: postId, restaurantId }, include: postInclude });
    if (!row) throw notFound('SOCIAL_POST_NOT_FOUND', 'Post not found');
    return row;
  }

  private async editable(restaurantId: string, postId: string): Promise<PostRow> {
    const row = await this.require(restaurantId, postId);
    if (!isEditable(row)) throw conflict('SOCIAL_POST_LOCKED', 'The post can no longer be changed');
    return row;
  }

  /** The tenant's chosen accounts; every one must be connected, in use and active. */
  private async accounts(restaurantId: string, ids: readonly string[]) {
    const rows = await this.prisma.socialAccount.findMany({
      where: { id: { in: [...ids] }, restaurantId, enabled: true, status: 'ACTIVE' },
      select: { id: true, name: true, kind: true },
    });
    if (rows.length !== ids.length) throw badRequest('SOCIAL_ACCOUNT_UNAVAILABLE', 'An account is not available');
    return rows;
  }

  private assertPublishable(post: PostRow): void {
    if (post.targets.length === 0) throw badRequest('SOCIAL_ACCOUNT_UNAVAILABLE', 'The post has no account');
    const problems = socialPostProblems({
      body: post.body,
      hasImage: post.imageUrl !== null,
      kinds: post.targets.map((t) => t.kind as SocialAccountKind),
    });
    if (problems.length > 0) throw badRequest('SOCIAL_POST_INVALID', problems.join(','));
  }

  private async moduleOn(restaurantId: string): Promise<boolean> {
    return (
      (await this.features.isEnabled('social_publishing', restaurantId)) &&
      (await this.features.isEnabled('integration_hub', restaurantId))
    );
  }

  private async audit(
    restaurantId: string,
    actorUserId: string,
    action: string,
    postId: string,
    meta: Record<string, string> = {},
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: { restaurantId, actorUserId, action, entity: 'social_post', entityId: postId, meta },
    });
  }
}

function toDto(row: PostRow): SocialPostDTO {
  const kinds = row.targets.map((t) => t.kind as SocialAccountKind);
  return {
    id: row.id,
    body: row.body,
    imageUrl: row.imageUrl,
    status: row.status as SocialPostStatus,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy?.fullName ?? null,
    targets: row.targets.map((t) => ({
      accountId: t.socialAccountId,
      accountName: t.accountName,
      kind: t.kind as SocialAccountKind,
      status: t.status as SocialTargetStatus,
      externalPostId: t.externalPostId,
      reason: (t.reason as SocialTargetReason | null) ?? null,
      attempts: t.attempts,
      publishedAt: t.publishedAt?.toISOString() ?? null,
    })),
    editable: isEditable(row),
    problems: isEditable(row) ? socialPostProblems({ body: row.body, hasImage: row.imageUrl !== null, kinds }) : [],
  };
}
