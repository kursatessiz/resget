import { Controller, Get, Headers, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  CheckoutRequestSchema,
  CollectPaymentSchema,
  SlugSchema,
  TrackingTokenSchema,
  UuidSchema,
} from '@resget/shared';
import type { AcceptedPaymentMethodsDTO, CheckoutSessionDTO, OrderDetailDTO } from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { badRequest, notFound } from '../../common/api-error';
import { CheckoutService } from './checkout.service';
import type { WebhookOutcome } from './checkout.service';
import { MealCardsService } from './meal-cards.service';

const WebhookKindSchema = z.enum(['meal-cards', 'pos']);

/** Staff-side payment actions on an order. */
@Controller('restaurants/:restaurantId/orders/:orderId')
@RestaurantScoped()
export class OrderPaymentsController {
  constructor(private readonly checkout: CheckoutService) {}

  /** A hosted payment session for an order waiting in PENDING_PAYMENT. */
  @Post('checkout')
  @HttpCode(200)
  @RequirePermission('orders.manage')
  start(
    @Tenant() tenant: TenantContext,
    @ZodParam('orderId', UuidSchema) orderId: string,
    @ZodBody(CheckoutRequestSchema) body: z.infer<typeof CheckoutRequestSchema>,
    @Req() req: Request,
  ): Promise<CheckoutSessionDTO> {
    return this.checkout.startCheckout(tenant.restaurantId, orderId, body.returnUrl, req.ip);
  }

  /** Cash, card or a meal card taken at the counter or the door. */
  @Post('collect')
  @HttpCode(200)
  @RequirePermission('orders.manage')
  collect(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('orderId', UuidSchema) orderId: string,
    @ZodBody(CollectPaymentSchema) body: z.infer<typeof CollectPaymentSchema>,
  ): Promise<OrderDetailDTO> {
    return this.checkout.collect(
      tenant.restaurantId,
      orderId,
      body,
      user.id,
      tenant.permissions.has('customers.contact.view'),
    );
  }
}

/** Public payment surface: what a restaurant accepts and the customer's own checkout, by tracking token. */
@Controller('public')
export class PublicPaymentsController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly mealCards: MealCardsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('restaurants/:slug/payment-methods')
  async acceptedMethods(@ZodParam('slug', SlugSchema) slug: string): Promise<AcceptedPaymentMethodsDTO> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { slug },
      select: { id: true, isActive: true },
    });
    if (!restaurant || !restaurant.isActive) throw notFound('NOT_FOUND', 'Restaurant not found');
    return this.mealCards.acceptedMethods(restaurant.id);
  }

  @Post('orders/:token/checkout')
  @HttpCode(200)
  publicCheckout(
    @ZodParam('token', TrackingTokenSchema) token: string,
    @ZodBody(CheckoutRequestSchema) body: z.infer<typeof CheckoutRequestSchema>,
    @Req() req: Request,
  ): Promise<CheckoutSessionDTO> {
    return this.checkout.startPublicCheckout(token, body.returnUrl, req.ip);
  }
}

/**
 * Provider notifications. Unauthenticated by nature; every request is
 * verified against the signature the connection's credentials produce
 * before anything is written.
 */
@Controller('webhooks/payments')
export class PaymentWebhooksController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post(':kind/:connectionId')
  @HttpCode(200)
  async receive(
    @ZodParam('kind', WebhookKindSchema) kind: z.infer<typeof WebhookKindSchema>,
    @ZodParam('connectionId', UuidSchema) connectionId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
    @Query() query: Record<string, string | undefined>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WebhookOutcome | string | undefined> {
    const raw = req.rawBody?.toString('utf8');
    if (!raw) throw badRequest('WEBHOOK_INVALID', 'Empty body');
    const outcome = await this.checkout.handleWebhook(kind, connectionId, raw, headers, query);
    // A provider callback that carried the customer's browser is sent on to the order page.
    if (outcome.browserRedirectUrl) {
      res.redirect(303, outcome.browserRedirectUrl);
      return undefined;
    }
    // Some providers insist on their own acknowledgement text and retry on anything else.
    if (outcome.ack) {
      res.type(outcome.ack.contentType);
      return outcome.ack.body;
    }
    return outcome;
  }
}
