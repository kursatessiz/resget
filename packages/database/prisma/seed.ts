import { PrismaClient, MessageChannel, SubscriptionStatus, MembershipStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import {
  DEFAULT_ROLE_TEMPLATES,
  PLAN_CODES,
  PRO_TRIAL_DAYS_DEFAULT,
  TABLE_QR_TOKEN_BYTES,
  WELCOME_MESSAGE_CREDITS_DEFAULT,
  computeModeSettlement,
  normalizePhone,
  settlementDefaultsFor,
  trialEndFrom,
} from '@resget/shared';

// Development-only tool: it truncates every table before writing, so it must
// never run against a production database.
if (process.env.NODE_ENV === 'production') {
  throw new Error('Seed cannot run when NODE_ENV=production. Refusing.');
}

const prisma = new PrismaClient();

/** Phones and the table token the e2e suites rely on (apps/api/test/e2e, apps/web/e2e). */
export const DEMO_SUPER_ADMIN_PHONE = '05320000001';
export const DEMO_OWNER_PHONE = '05320000002';
export const DEMO_GUEST_PHONE = '05320000003';
export const DEMO_COURIER_PHONE = '05320000004';
export const DEMO_TABLE_TOKEN = 'demo-masa-1-sabit-token-0001';
/** A placed delivery order of the guest, so /t/<token> can be opened without creating one. */
export const DEMO_TRACKING_TOKEN = 'demo-siparis-takip-token-0001';

function qrToken(): string {
  return randomBytes(TABLE_QR_TOKEN_BYTES).toString('base64url');
}

async function truncateAll(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function main(): Promise<void> {
  await truncateAll();

  // Platform data: plans, credit packages, a mock courier network, one launched district.
  const [basic, pro] = await Promise.all(
    PLAN_CODES.map((code) =>
      prisma.plan.create({
        data: {
          code,
          name: code === 'BASIC' ? 'Temel' : 'Pro',
          monthlyPriceMinor: code === 'BASIC' ? 0 : 149900,
          currency: 'TRY',
          isFree: code === 'BASIC',
          trialDays: code === 'PRO' ? PRO_TRIAL_DAYS_DEFAULT : 0,
        },
      }),
    ),
  );
  await prisma.messageCreditPackage.createMany({
    data: [
      { code: 'sms-500', channel: MessageChannel.SMS, credits: 500, priceMinor: 49900, currency: 'TRY' },
      { code: 'sms-2000', channel: MessageChannel.SMS, credits: 2000, priceMinor: 179900, currency: 'TRY' },
      { code: 'wa-500', channel: MessageChannel.WHATSAPP, credits: 500, priceMinor: 69900, currency: 'TRY' },
    ],
  });
  const mockCourier = await prisma.courierProvider.create({
    data: { code: 'MOCK', name: 'Mock courier network', countryCode: 'TR' },
  });
  const area = await prisma.serviceArea.create({
    data: { countryCode: 'TR', city: 'Istanbul', district: 'Kadikoy', isLaunched: true, launchedAt: new Date() },
  });

  // Super admin (platform owner) and a demo restaurant owner.
  const superAdmin = await prisma.user.create({
    data: {
      phone: normalizePhone(DEMO_SUPER_ADMIN_PHONE)!,
      fullName: 'Platform Admin',
      isSuperAdmin: true,
      locale: 'tr',
    },
  });
  const owner = await prisma.user.create({
    data: { phone: normalizePhone(DEMO_OWNER_PHONE)!, fullName: 'Demo Sahip', locale: 'tr' },
  });
  const guest = await prisma.user.create({
    data: { phone: normalizePhone(DEMO_GUEST_PHONE)!, fullName: 'Demo Misafir', locale: 'tr' },
  });
  const courier = await prisma.user.create({
    data: { phone: normalizePhone(DEMO_COURIER_PHONE)!, fullName: 'Demo Kurye', locale: 'tr' },
  });

  const restaurant = await prisma.restaurant.create({
    data: {
      slug: 'demo-lokanta',
      name: 'Demo Lokanta',
      countryCode: 'TR',
      currency: 'TRY',
      timezone: 'Europe/Istanbul',
      serviceAreaId: area.id,
      isListed: true,
      // A real PSP contract is passed through at cost (docs/MUTABAKAT.md); demo values.
      pspPercentBps: 200,
      pspFixedMinor: 25,
      deliveryMode: 'THIRD_PARTY_API',
      courierProviderId: mockCourier.id,
      deliveryFeePolicy: { mode: 'PASS_THROUGH', roundUpToMinor: 500 },
    },
  });
  const branch = await prisma.branch.create({
    data: {
      restaurantId: restaurant.id,
      name: 'Merkez',
      addressLine: 'Caferaga Mah. Moda Cad. No 1',
      city: 'Istanbul',
      district: 'Kadikoy',
      lat: 40.9867,
      lng: 29.0263,
      openingHours: {
        mon: [['10:00', '23:00']],
        tue: [['10:00', '23:00']],
        wed: [['10:00', '23:00']],
        thu: [['10:00', '23:00']],
        fri: [['10:00', '24:00']],
        sat: [['10:00', '24:00']],
        sun: [['11:00', '23:00']],
      },
    },
  });

  // Default roles; the owner template holds every permission.
  const roles = new Map<string, string>();
  for (const template of DEFAULT_ROLE_TEMPLATES) {
    const role = await prisma.roleTemplate.create({
      data: {
        restaurantId: restaurant.id,
        templateKey: template.key,
        name: template.key,
        isOwner: template.isOwner,
        permissions: { create: template.permissions.map((permissionKey) => ({ permissionKey })) },
      },
    });
    roles.set(template.key, role.id);
  }
  await prisma.membership.create({
    data: {
      userId: owner.id,
      restaurantId: restaurant.id,
      roleTemplateId: roles.get('owner')!,
      status: MembershipStatus.ACTIVE,
      joinedAt: new Date(),
    },
  });
  // The restaurant's own courier uses the same app with the courier role (docs/SIPARIS_VE_SEVK.md).
  await prisma.membership.create({
    data: {
      userId: courier.id,
      restaurantId: restaurant.id,
      roleTemplateId: roles.get('courier')!,
      status: MembershipStatus.ACTIVE,
      joinedAt: new Date(),
    },
  });

  // PRO trial and welcome credits.
  await prisma.restaurantSubscription.create({
    data: {
      restaurantId: restaurant.id,
      planId: pro.id,
      status: SubscriptionStatus.TRIALING,
      trialEndsAt: trialEndFrom(new Date()),
    },
  });
  for (const channel of [MessageChannel.SMS, MessageChannel.WHATSAPP] as const) {
    const credits = WELCOME_MESSAGE_CREDITS_DEFAULT[channel];
    await prisma.messageWallet.create({
      data: {
        restaurantId: restaurant.id,
        channel,
        balance: credits,
        transactions: { create: { type: 'GRANT', delta: credits, balanceAfter: credits, reference: 'welcome' } },
      },
    });
  }

  // Menu and tables.
  const mains = await prisma.menuCategory.create({
    data: { restaurantId: restaurant.id, name: 'Ana yemekler', sortOrder: 1 },
  });
  const drinks = await prisma.menuCategory.create({
    data: { restaurantId: restaurant.id, name: 'Icecekler', sortOrder: 2 },
  });
  const kofte = await prisma.menuItem.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: mains.id,
      name: 'Izgara kofte',
      priceMinor: 42000,
      currency: 'TRY',
      vatRateBps: 1000,
      sortOrder: 1,
    },
  });
  await prisma.menuItem.createMany({
    data: [
      {
        restaurantId: restaurant.id,
        categoryId: mains.id,
        name: 'Tavuk sis',
        priceMinor: 38000,
        currency: 'TRY',
        vatRateBps: 1000,
        sortOrder: 2,
      },
      {
        restaurantId: restaurant.id,
        categoryId: drinks.id,
        name: 'Ayran',
        priceMinor: 4000,
        currency: 'TRY',
        vatRateBps: 1000,
        sortOrder: 1,
      },
    ],
  });
  // Table 1 keeps a fixed token so the e2e suites and Lighthouse can open /m/<token> without a lookup.
  for (const label of ['1', '2', '3', '4']) {
    await prisma.diningTable.create({
      data: {
        restaurantId: restaurant.id,
        branchId: branch.id,
        label,
        qrToken: label === '1' ? DEMO_TABLE_TOKEN : qrToken(),
      },
    });
  }

  await prisma.restaurantCustomer.create({
    data: { restaurantId: restaurant.id, userId: guest.id, firstChannel: 'TABLE_QR' },
  });

  // One placed delivery order with a fixed tracking token (web e2e opens /t/<token>).
  const regional = settlementDefaultsFor(restaurant.countryCode);
  const settlement = computeModeSettlement(restaurant.paymentMode, {
    currency: restaurant.currency,
    items: [{ amountMinor: kofte.priceMinor * 2, vatRateBps: kofte.vatRateBps }],
    deliveryFee: { amountMinor: 1500, vatRateBps: 1000 },
    commissionBps: restaurant.commissionBps,
    commissionVatBps: regional.commissionVatBps,
    psp: { percentBps: restaurant.pspPercentBps, fixedMinor: restaurant.pspFixedMinor, bearer: 'RESTAURANT' },
    withholdingBps: regional.withholdingBps,
  });
  await prisma.order.create({
    data: {
      restaurantId: restaurant.id,
      branchId: branch.id,
      customerUserId: guest.id,
      channel: 'RESTAURANT_SITE',
      fulfillment: 'DELIVERY',
      deliveryMode: 'RESTAURANT_COURIER',
      status: 'PLACED',
      currency: restaurant.currency,
      itemsGrossMinor: settlement.itemsGrossMinor,
      itemsVatMinor: settlement.itemsVatMinor,
      deliveryFeeMinor: settlement.deliveryFeeMinor,
      chargedToCustomerMinor: settlement.chargedToCustomerMinor,
      commissionBps: restaurant.commissionBps,
      platformCommissionMinor: settlement.platformCommissionMinor,
      commissionVatMinor: settlement.commissionVatMinor,
      pspFeeMinor: settlement.pspFeeMinor,
      withholdingMinor: settlement.withholdingMinor,
      restaurantPayableMinor: settlement.restaurantPayableMinor,
      paymentMode: restaurant.paymentMode,
      platformReceivableMinor: settlement.platformReceivableMinor,
      trackingToken: DEMO_TRACKING_TOKEN,
      addressSnapshot: {
        addressLine: 'Bahariye Cad. No 20 D 4',
        city: 'Istanbul',
        district: 'Kadikoy',
        contactName: guest.fullName,
        contactPhone: guest.phone,
        point: { lat: 40.9892, lng: 29.0301 },
      },
      items: {
        create: {
          menuItemId: kofte.id,
          nameSnapshot: kofte.name,
          unitPriceMinor: kofte.priceMinor,
          quantity: 2,
          vatRateBps: kofte.vatRateBps,
          modifiersSnapshot: [],
          lineTotalMinor: kofte.priceMinor * 2,
        },
      },
      statusHistory: { create: { fromStatus: null, toStatus: 'PLACED', actorUserId: guest.id } },
    },
  });

  // Unused plan reference keeps the free tier visible in the seed output.
  console.log(
    `Seeded: plans ${basic.code}/${pro.code}, restaurant ${restaurant.slug}, owner ${owner.phone}, super admin ${superAdmin.phone}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
