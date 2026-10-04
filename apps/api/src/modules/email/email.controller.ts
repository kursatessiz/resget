import { Controller, Delete, Get, HttpCode, Logger, Post, Req, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { AddEmailDomainSchema, AddEmailSuppressionSchema, SendTestEmailSchema, UuidSchema } from '@resget/shared';
import type {
  AddEmailDomainInput,
  AddEmailSuppressionInput,
  EmailDomainDTO,
  EmailSettingsDTO,
  EmailSuppressionDTO,
  SendTestEmailInput,
} from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { badRequest } from '../../common/api-error';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { PublicRateLimitGuard, RateLimit } from '../storefront/public-rate-limit.guard';
import { EmailService } from './email.service';
import { SnsVerifier, isSnsMessage } from './sns-verifier';

/** The restaurant's sending domains, suppression list and a test send (docs/EPOSTA.md). */
@Controller('restaurants/:restaurantId/email')
@RestaurantScoped()
@RequireFeature('email_channel')
export class EmailController {
  constructor(private readonly email: EmailService) {}

  @Get()
  @RequirePermission('integrations.manage')
  settings(@Tenant() tenant: TenantContext): Promise<EmailSettingsDTO> {
    return this.email.settings(tenant.restaurantId);
  }

  @Post('domains')
  @RequirePermission('integrations.manage')
  addDomain(
    @Tenant() tenant: TenantContext,
    @ZodBody(AddEmailDomainSchema) body: AddEmailDomainInput,
  ): Promise<EmailDomainDTO> {
    return this.email.addDomain(tenant.restaurantId, body);
  }

  @Post('domains/:domainId/verify')
  @HttpCode(200)
  @RequirePermission('integrations.manage')
  verify(@Tenant() tenant: TenantContext, @ZodParam('domainId', UuidSchema) domainId: string): Promise<EmailDomainDTO> {
    return this.email.verifyDomain(tenant.restaurantId, domainId);
  }

  @Delete('domains/:domainId')
  @HttpCode(204)
  @RequirePermission('integrations.manage')
  async removeDomain(
    @Tenant() tenant: TenantContext,
    @ZodParam('domainId', UuidSchema) domainId: string,
  ): Promise<void> {
    await this.email.removeDomain(tenant.restaurantId, domainId);
  }

  @Post('suppressions')
  @RequirePermission('integrations.manage')
  addSuppression(
    @Tenant() tenant: TenantContext,
    @ZodBody(AddEmailSuppressionSchema) body: AddEmailSuppressionInput,
  ): Promise<EmailSuppressionDTO[]> {
    return this.email.addSuppression(tenant.restaurantId, body.email);
  }

  @Delete('suppressions/:suppressionId')
  @RequirePermission('integrations.manage')
  removeSuppression(
    @Tenant() tenant: TenantContext,
    @ZodParam('suppressionId', UuidSchema) suppressionId: string,
  ): Promise<EmailSuppressionDTO[]> {
    return this.email.removeSuppression(tenant.restaurantId, suppressionId);
  }

  @Post('test')
  @HttpCode(200)
  @RequirePermission('integrations.manage')
  async test(
    @Tenant() tenant: TenantContext,
    @ZodBody(SendTestEmailSchema) body: SendTestEmailInput,
  ): Promise<{ status: string; errorCode: string | null }> {
    const result = await this.email.sendTest(tenant.restaurantId, body.to);
    return { status: result.status, errorCode: result.errorCode };
  }
}

/**
 * SES feedback through SNS (docs/EPOSTA.md). Only signed messages from the
 * configured topics are read; a subscription is confirmed by fetching the
 * signed SubscribeURL, which must be on Amazon's SNS host.
 */
@Controller('webhooks/email')
@UseGuards(PublicRateLimitGuard)
export class EmailWebhooksController {
  private readonly logger = new Logger(EmailWebhooksController.name);

  constructor(
    private readonly email: EmailService,
    private readonly verifier: SnsVerifier,
  ) {}

  @Post('ses')
  @HttpCode(204)
  @RateLimit({ bucket: 'email_webhook', limit: 600, windowSeconds: 60 })
  async ses(@Req() req: RawBodyRequest<Request>): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(req.rawBody?.toString('utf8') ?? '');
    } catch {
      throw badRequest('VALIDATION', 'Not an SNS message');
    }
    if (!isSnsMessage(message)) throw badRequest('VALIDATION', 'Not an SNS message');
    if (!this.email.allowedTopics().includes(message.TopicArn)) return;
    if (!(await this.verifier.verify(message))) {
      this.logger.warn('SNS message with an invalid signature dropped');
      return;
    }
    if (message.Type === 'SubscriptionConfirmation' && message.SubscribeURL) {
      const url = new URL(message.SubscribeURL);
      if (url.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(url.hostname)) {
        await fetch(url, { signal: AbortSignal.timeout(5000) }).catch(() => undefined);
      }
      return;
    }
    if (message.Type !== 'Notification') return;
    try {
      await this.email.handleSesEvent(JSON.parse(message.Message));
    } catch (error) {
      this.email.logFailure('SES event', error);
    }
  }
}
