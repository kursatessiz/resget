import { Controller, Get, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import {
  MarketplaceInterestSchema,
  MarketplaceQuerySchema,
  PublicOrderSchema,
  QrScanSessionSchema,
  SlugSchema,
  StartedOrderSchema,
  TableQrTokenSchema,
} from '@resget/shared';
import type {
  MarketplaceAreaDTO,
  MarketplaceDTO,
  MarketplaceInterestResultDTO,
  PublicOrderResultDTO,
  StorefrontDTO,
} from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import { OptionalUser } from '../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import type { AuthUser } from '../auth/tenant-context';
import { PublicRateLimitGuard, RateLimit } from './public-rate-limit.guard';
import { StorefrontService } from './storefront.service';

function sessionOf(header: string | undefined): string | null {
  return header && QrScanSessionSchema.safeParse(header).success ? header : null;
}

/** Unauthenticated consumer endpoints; writes are rate limited per client (docs/VITRIN.md). */
@Controller('public')
@UseGuards(PublicRateLimitGuard)
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  /** The page behind a table QR: menu with option groups, what can be ordered and how it can be paid. */
  @Get('qr/:token')
  byToken(
    @ZodParam('token', TableQrTokenSchema) token: string,
    @Headers('x-qr-session') session?: string,
  ): Promise<StorefrontDTO> {
    return this.storefront.byTableToken(token, sessionOf(session));
  }

  @Post('qr/:token/funnel')
  @HttpCode(204)
  @RateLimit({ bucket: 'funnel', limit: 60, windowSeconds: 600 })
  async started(
    @ZodParam('token', TableQrTokenSchema) token: string,
    @ZodBody(StartedOrderSchema) _body: z.infer<typeof StartedOrderSchema>,
    @Headers('x-qr-session') session?: string,
  ): Promise<void> {
    void _body;
    await this.storefront.started(token, sessionOf(session));
  }

  /** A signed-in visitor may spend loyalty points, so the guard is optional: anonymous orders stay anonymous. */
  @Post('qr/:token/orders')
  @HttpCode(201)
  @UseGuards(OptionalJwtAuthGuard)
  @RateLimit({ bucket: 'order', limit: 10, windowSeconds: 600 })
  orderByToken(
    @ZodParam('token', TableQrTokenSchema) token: string,
    @ZodBody(PublicOrderSchema) body: z.infer<typeof PublicOrderSchema>,
    @OptionalUser() viewer: AuthUser | null,
    @Headers('x-qr-session') session?: string,
  ): Promise<PublicOrderResultDTO> {
    return this.storefront.placeByTableToken(token, body, sessionOf(session), viewer);
  }

  /** The restaurant's own ordering page at /<slug>. */
  @Get('restaurants/:slug/menu')
  bySlug(@ZodParam('slug', SlugSchema) slug: string): Promise<StorefrontDTO> {
    return this.storefront.bySlug(slug);
  }

  @Post('restaurants/:slug/orders')
  @HttpCode(201)
  @UseGuards(OptionalJwtAuthGuard)
  @RateLimit({ bucket: 'order', limit: 10, windowSeconds: 600 })
  orderBySlug(
    @ZodParam('slug', SlugSchema) slug: string,
    @ZodBody(PublicOrderSchema) body: z.infer<typeof PublicOrderSchema>,
    @OptionalUser() viewer: AuthUser | null,
  ): Promise<PublicOrderResultDTO> {
    return this.storefront.placeBySlug(slug, body, viewer);
  }

  @Get('marketplace/areas')
  areas(): Promise<MarketplaceAreaDTO[]> {
    return this.storefront.areas();
  }

  /** A visitor asks for a district that is not open yet (docs/PLATFORM_YONETIMI.md, launch tools). */
  @Post('marketplace/interest')
  @HttpCode(200)
  @RateLimit({ bucket: 'funnel', limit: 10, windowSeconds: 600 })
  interest(
    @ZodBody(MarketplaceInterestSchema) body: z.infer<typeof MarketplaceInterestSchema>,
  ): Promise<MarketplaceInterestResultDTO> {
    return this.storefront.interest(body);
  }

  @Get('marketplace')
  marketplace(
    @ZodQuery(MarketplaceQuerySchema) query: z.infer<typeof MarketplaceQuerySchema>,
  ): Promise<MarketplaceDTO> {
    return this.storefront.marketplace(query);
  }
}
