import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env';
import { PrismaModule } from './modules/prisma/prisma.module';
import { RedisModule } from './modules/redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { AuthModule } from './modules/auth/auth.module';
import { RestaurantsModule } from './modules/restaurants/restaurants.module';
import { MenuModule } from './modules/menu/menu.module';
import { OrdersModule } from './modules/orders/orders.module';
import { CourierModule } from './modules/courier/courier.module';
import { TablesModule } from './modules/tables/tables.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { StaffModule } from './modules/staff/staff.module';
import { CreditsModule } from './modules/credits/credits.module';
import { AdminModule } from './modules/admin/admin.module';
import { StorefrontModule } from './modules/storefront/storefront.module';
import { BillingModule } from './modules/billing/billing.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ReportsModule } from './modules/reports/reports.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { AccountModule } from './modules/account/account.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { FeaturesModule } from './modules/features/features.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { PosModule } from './modules/pos/pos.module';
import { PlatformModule } from './modules/platform/platform.module';
import { CrmModule } from './modules/crm/crm.module';
import { AttributionModule } from './modules/attribution/attribution.module';
import { ConsentModule } from './modules/consent/consent.module';
import { EmailModule } from './modules/email/email.module';
import { SegmentsModule } from './modules/segments/segments.module';
import { CampaignCoreModule } from './modules/campaigns/campaign-core.module';
import { JourneysModule } from './modules/journeys/journeys.module';
import { AdsModule } from './modules/ads/ads.module';
import { SiteModule } from './modules/site/site.module';
import { IndexNowModule } from './modules/site/indexnow.service';
import { PartnerReferralsModule } from './modules/partner-referrals/partner-referrals.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { ChurnModule } from './modules/churn/churn.module';
import { GovernanceModule } from './modules/governance/governance.module';
import { AiStudioModule } from './modules/ai-studio/ai-studio.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { DomainsModule } from './modules/domains/domains.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { GeocodingModule } from './modules/geocoding/geocoding.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { PushModule } from './modules/push/push.module';
import { PayoutsModule } from './modules/payouts/payouts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'], validate: validateEnv }),
    PrismaModule,
    RedisModule,
    LedgerModule,
    FeaturesModule,
    LoyaltyModule,
    GeocodingModule,
    WebhooksModule,
    PushModule,
    DomainsModule,
    ApiKeysModule,
    RealtimeModule,
    HealthModule,
    MessagingModule,
    AuthModule,
    RestaurantsModule,
    MenuModule,
    OrdersModule,
    CourierModule,
    TablesModule,
    PaymentsModule,
    DispatchModule,
    StaffModule,
    CreditsModule,
    AdminModule,
    StorefrontModule,
    AvailabilityModule,
    CouponsModule,
    PosModule,
    PlatformModule,
    CrmModule,
    AttributionModule,
    ConsentModule,
    EmailModule,
    SegmentsModule,
    CampaignCoreModule,
    JourneysModule,
    AdsModule,
    SiteModule,
    IndexNowModule,
    PartnerReferralsModule,
    FeedbackModule,
    ChurnModule,
    GovernanceModule,
    AiStudioModule,
    BillingModule,
    CustomersModule,
    ReportsModule,
    UploadsModule,
    CampaignsModule,
    AccountModule,
    PayoutsModule,
  ],
})
export class AppModule {}
