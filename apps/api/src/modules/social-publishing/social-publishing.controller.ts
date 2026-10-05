import { Controller, Delete, Get, HttpCode, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  SOCIAL_IMAGE_MAX_BYTES,
  ScheduleSocialPostSchema,
  SocialPostInputSchema,
  SocialPostsQuerySchema,
  UuidSchema,
} from '@resget/shared';
import type {
  ScheduleSocialPostInput,
  SocialAccountDTO,
  SocialPostDTO,
  SocialPostInput,
  SocialPostPageDTO,
  SocialPostsQuery,
} from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import type { UploadedImage } from '../uploads/uploads.service';
import { SocialPublishingService } from './social-publishing.service';

/** Posts for the tenant's connected social accounts (docs/SOSYAL_YAYIN.md). */
@Controller('restaurants/:restaurantId/social/posts')
@RestaurantScoped()
@RequireFeature('social_publishing')
export class SocialPublishingController {
  constructor(private readonly posts: SocialPublishingService) {}

  @Get()
  @RequirePermission('campaigns.view')
  list(
    @Tenant() tenant: TenantContext,
    @ZodQuery(SocialPostsQuerySchema) query: SocialPostsQuery,
  ): Promise<SocialPostPageDTO> {
    return this.posts.list(tenant.restaurantId, query.page);
  }

  /** The accounts a post can go to: connected, in use and active. */
  @Get('accounts')
  @RequirePermission('campaigns.manage')
  accounts(@Tenant() tenant: TenantContext): Promise<SocialAccountDTO[]> {
    return this.posts.publishableAccounts(tenant.restaurantId);
  }

  @Post()
  @RequirePermission('campaigns.manage')
  create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(SocialPostInputSchema) body: SocialPostInput,
  ): Promise<SocialPostDTO> {
    return this.posts.create(tenant.restaurantId, user.id, body);
  }

  @Patch(':postId')
  @RequirePermission('campaigns.manage')
  update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('postId', UuidSchema) postId: string,
    @ZodBody(SocialPostInputSchema) body: SocialPostInput,
  ): Promise<SocialPostDTO> {
    return this.posts.update(tenant.restaurantId, postId, user.id, body);
  }

  @Delete(':postId')
  @HttpCode(204)
  @RequirePermission('campaigns.manage')
  remove(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('postId', UuidSchema) postId: string,
  ): Promise<void> {
    return this.posts.remove(tenant.restaurantId, postId, user.id);
  }

  /** One multipart field named `file`: PNG, JPEG or WebP, at most SOCIAL_IMAGE_MAX_BYTES. */
  @Post(':postId/image')
  @HttpCode(200)
  @RequirePermission('campaigns.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: SOCIAL_IMAGE_MAX_BYTES, files: 1 } }))
  setImage(
    @Tenant() tenant: TenantContext,
    @ZodParam('postId', UuidSchema) postId: string,
    @UploadedFile() file?: UploadedImage,
  ): Promise<SocialPostDTO> {
    return this.posts.setImage(tenant.restaurantId, postId, file);
  }

  @Delete(':postId/image')
  @RequirePermission('campaigns.manage')
  removeImage(@Tenant() tenant: TenantContext, @ZodParam('postId', UuidSchema) postId: string): Promise<SocialPostDTO> {
    return this.posts.removeImage(tenant.restaurantId, postId);
  }

  @Post(':postId/schedule')
  @HttpCode(200)
  @RequirePermission('campaigns.manage')
  schedule(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('postId', UuidSchema) postId: string,
    @ZodBody(ScheduleSocialPostSchema) body: ScheduleSocialPostInput,
  ): Promise<SocialPostDTO> {
    return this.posts.schedule(tenant.restaurantId, postId, user.id, new Date(body.scheduledAt));
  }

  @Post(':postId/unschedule')
  @HttpCode(200)
  @RequirePermission('campaigns.manage')
  unschedule(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('postId', UuidSchema) postId: string,
  ): Promise<SocialPostDTO> {
    return this.posts.unschedule(tenant.restaurantId, postId, user.id);
  }

  @Post(':postId/publish')
  @HttpCode(200)
  @RequirePermission('campaigns.manage')
  publish(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('postId', UuidSchema) postId: string,
  ): Promise<SocialPostDTO> {
    return this.posts.publishNow(tenant.restaurantId, postId, user.id);
  }
}
