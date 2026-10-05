import { Controller, Get, Headers, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import {
  CreateGroupCartSchema,
  GROUP_KEY_HEADER,
  GroupCartTokenSchema,
  GroupLinesSchema,
  JoinGroupCartSchema,
  PublicOrderSchema,
  SlugSchema,
  UuidSchema,
  VISITOR_HEADER,
} from '@resget/shared';
import type {
  CreateGroupCartInput,
  GroupCartDTO,
  GroupLinesInput,
  GroupMembershipDTO,
  JoinGroupCartInput,
  PublicOrderInput,
  PublicOrderResultDTO,
} from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { OptionalUser } from '../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import type { AuthUser } from '../auth/tenant-context';
import { GroupOrdersService } from './group-orders.service';
import { PublicRateLimitGuard, RateLimit } from './public-rate-limit.guard';

/** The shared basket of a group order (docs/GRUP_SIPARISI.md); each browser proves itself with x-group-key. */
@Controller('public')
@UseGuards(PublicRateLimitGuard)
export class GroupOrdersController {
  constructor(private readonly groups: GroupOrdersService) {}

  @Post('restaurants/:slug/group-carts')
  @HttpCode(201)
  @RateLimit({ bucket: 'group', limit: 20, windowSeconds: 600 })
  create(
    @ZodParam('slug', SlugSchema) slug: string,
    @ZodBody(CreateGroupCartSchema) body: CreateGroupCartInput,
  ): Promise<GroupMembershipDTO> {
    return this.groups.create(slug, body.name);
  }

  @Get('group-carts/:token')
  @RateLimit({ bucket: 'group-read', limit: 600, windowSeconds: 600 })
  get(
    @ZodParam('token', GroupCartTokenSchema) token: string,
    @Headers(GROUP_KEY_HEADER) key?: string,
  ): Promise<GroupCartDTO> {
    return this.groups.get(token, key);
  }

  @Post('group-carts/:token/participants')
  @HttpCode(201)
  @RateLimit({ bucket: 'group', limit: 20, windowSeconds: 600 })
  join(
    @ZodParam('token', GroupCartTokenSchema) token: string,
    @ZodBody(JoinGroupCartSchema) body: JoinGroupCartInput,
  ): Promise<GroupMembershipDTO> {
    return this.groups.join(token, body.name);
  }

  @Put('group-carts/:token/participants/:participantId/lines')
  @RateLimit({ bucket: 'group-write', limit: 300, windowSeconds: 600 })
  lines(
    @ZodParam('token', GroupCartTokenSchema) token: string,
    @ZodParam('participantId', UuidSchema) participantId: string,
    @ZodBody(GroupLinesSchema) body: GroupLinesInput,
    @Headers(GROUP_KEY_HEADER) key?: string,
  ): Promise<GroupCartDTO> {
    return this.groups.setLines(token, participantId, key, body.lines);
  }

  @Post('group-carts/:token/lock')
  @HttpCode(200)
  @RateLimit({ bucket: 'group-write', limit: 300, windowSeconds: 600 })
  lock(
    @ZodParam('token', GroupCartTokenSchema) token: string,
    @Headers(GROUP_KEY_HEADER) key?: string,
  ): Promise<GroupCartDTO> {
    return this.groups.setLocked(token, key, true);
  }

  @Post('group-carts/:token/unlock')
  @HttpCode(200)
  @RateLimit({ bucket: 'group-write', limit: 300, windowSeconds: 600 })
  unlock(
    @ZodParam('token', GroupCartTokenSchema) token: string,
    @Headers(GROUP_KEY_HEADER) key?: string,
  ): Promise<GroupCartDTO> {
    return this.groups.setLocked(token, key, false);
  }

  /** The host's checkout: the same body as a single order; the items come from everyone's lines. */
  @Post('group-carts/:token/orders')
  @HttpCode(201)
  @UseGuards(OptionalJwtAuthGuard)
  @RateLimit({ bucket: 'order', limit: 10, windowSeconds: 600 })
  place(
    @ZodParam('token', GroupCartTokenSchema) token: string,
    @ZodBody(PublicOrderSchema) body: PublicOrderInput,
    @OptionalUser() viewer: AuthUser | null,
    @Headers(GROUP_KEY_HEADER) key?: string,
    @Headers(VISITOR_HEADER) visitorId?: string,
  ): Promise<PublicOrderResultDTO> {
    return this.groups.place(token, key, body, viewer, visitorId ?? null);
  }
}
