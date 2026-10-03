import { Controller, Get, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import {
  MarketplaceQuerySchema,
  PublicOrderSchema,
  QrScanSessionSchema,
  SlugSchema,
  StartedOrderSchema,
  TableQrTokenSchema,
} from '@resget/shared';
import type { MarketplaceAreaDTO, MarketplaceDTO, PublicOrderResultDTO, StorefrontDTO } from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
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

  @Post('qr/:token/orders')
  @HttpCode(201)
  @RateLimit({ bucket: 'order', limit: 10, windowSeconds: 600 })
  orderByToken(
    @ZodParam('token', TableQrTokenSchema) token: string,
    @ZodBody(PublicOrderSchema) body: z.infer<typeof PublicOrderSchema>,
    @Headers('x-qr-session') session?: string,
  ): Promise<PublicOrderResultDTO> {
    return this.storefront.placeByTableToken(token, body, sessionOf(session));
  }

  /** The restaurant's own ordering page at /<slug>. */
  @Get('restaurants/:slug/menu')
  bySlug(@ZodParam('slug', SlugSchema) slug: string): Promise<StorefrontDTO> {
    return this.storefront.bySlug(slug);
  }

  @Post('restaurants/:slug/orders')
  @HttpCode(201)
  @RateLimit({ bucket: 'order', limit: 10, windowSeconds: 600 })
  orderBySlug(
    @ZodParam('slug', SlugSchema) slug: string,
    @ZodBody(PublicOrderSchema) body: z.infer<typeof PublicOrderSchema>,
  ): Promise<PublicOrderResultDTO> {
    return this.storefront.placeBySlug(slug, body);
  }

  @Get('marketplace/areas')
  areas(): Promise<MarketplaceAreaDTO[]> {
    return this.storefront.areas();
  }

  @Get('marketplace')
  marketplace(
    @ZodQuery(MarketplaceQuerySchema) query: z.infer<typeof MarketplaceQuerySchema>,
  ): Promise<MarketplaceDTO> {
    return this.storefront.marketplace(query);
  }
}
