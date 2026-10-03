import { z } from 'zod';
import { PaymentMode } from './enums';
import type { SubscriptionStatus } from './enums';
import { LocaleCodeSchema } from './i18n/locales';
import { BasisPointsSchema, CurrencyCodeSchema, MinorAmountSchema } from './money';
import { PhoneSchema, RESERVED_SLUGS } from './validators';
import { CREDIT_CHANNELS, PlanCodeSchema } from './plans';
import type { CreditChannel, PlanCode } from './plans';
import { CountryCodeSchema, SlugSchema, UuidSchema } from './validators';

/**
 * Restaurant onboarding and the platform owner's console (docs/PLATFORM_YONETIMI.md).
 * A restaurant is created either by its owner at /kayit or by the super
 * admin; both go through the same provisioning. Platform data (commission,
 * listing, service areas, plans, packages) is the super admin's alone.
 */

// -- Sign-up ---------------------------------------------------------------------------

/** Countries the sign-up offers today with their currency and time zone defaults; the list grows with launches. */
export const SIGNUP_COUNTRIES = [
  { code: 'TR', currency: 'TRY', timezone: 'Europe/Istanbul', locale: 'tr' },
  { code: 'DE', currency: 'EUR', timezone: 'Europe/Berlin', locale: 'en' },
  { code: 'NL', currency: 'EUR', timezone: 'Europe/Amsterdam', locale: 'en' },
  { code: 'GB', currency: 'GBP', timezone: 'Europe/London', locale: 'en' },
  { code: 'AE', currency: 'AED', timezone: 'Asia/Dubai', locale: 'en' },
  { code: 'US', currency: 'USD', timezone: 'America/New_York', locale: 'en' },
] as const;
export type SignupCountryCode = (typeof SIGNUP_COUNTRIES)[number]['code'];

export const TimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (zone) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'unknown time zone' },
  );

const Name = z.string().trim().min(2).max(80);

export const BranchInputSchema = z
  .object({
    name: Name.default('Merkez'),
    addressLine: z.string().trim().min(5).max(200),
    city: z.string().trim().min(2).max(80),
    district: z.string().trim().min(2).max(80),
    postalCode: z.string().trim().max(16).optional(),
    phone: PhoneSchema.optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .strict();
export type BranchInput = z.infer<typeof BranchInputSchema>;

export const RestaurantSignupSchema = z
  .object({
    name: Name,
    /** Omitted: derived from the name and made unique. */
    slug: SlugSchema.optional(),
    countryCode: CountryCodeSchema,
    currency: CurrencyCodeSchema,
    timezone: TimezoneSchema,
    defaultLocale: LocaleCodeSchema.default('tr'),
    legalName: z.string().trim().max(160).optional(),
    taxId: z.string().trim().max(32).optional(),
    branch: BranchInputSchema,
  })
  .strict();
export type RestaurantSignupInput = z.infer<typeof RestaurantSignupSchema>;

/** Super admin creates a restaurant for an owner identified by phone; an unknown phone becomes a user. */
export const AdminCreateRestaurantSchema = RestaurantSignupSchema.extend({
  ownerPhone: PhoneSchema,
  ownerName: z.string().trim().min(2).max(120),
}).strict();
export type AdminCreateRestaurantInput = z.infer<typeof AdminCreateRestaurantSchema>;

const TURKISH_MAP: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** ASCII slug from a business name: Turkish letters transliterated, anything else dropped, dashes collapsed. */
export function slugify(name: string): string {
  const lowered = name
    .toLocaleLowerCase('tr')
    .split('')
    .map((char) => TURKISH_MAP[char] ?? char)
    .join('')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
  const parts = lowered.split(/[^a-z0-9]+/).filter((part) => part.length > 0);
  const slug = parts.join('-').slice(0, 60).replace(/-+$/, '') || 'isletme';
  return (RESERVED_SLUGS as readonly string[]).includes(slug) ? `${slug}-isletme` : slug;
}

export interface RestaurantCreatedDTO {
  id: string;
  slug: string;
  name: string;
}

// -- Super admin -----------------------------------------------------------------------

/** Console navigation; labels are `admin.nav.<key>`, paths relative to /admin. */
export const ADMIN_NAV = [
  { key: 'overview', path: '' },
  { key: 'restaurants', path: '/restoranlar' },
  { key: 'areas', path: '/bolgeler' },
  { key: 'plans', path: '/planlar' },
  { key: 'invoices', path: '/faturalar' },
  { key: 'payouts', path: '/hakedisler' },
  { key: 'system', path: '/sistem' },
] as const;

export const AdminRestaurantUpdateSchema = z
  .object({
    isActive: z.boolean().optional(),
    isListed: z.boolean().optional(),
    /** Platform take rate; 100 = 1 percent. */
    commissionBps: BasisPointsSchema.max(2000).optional(),
    pspPercentBps: BasisPointsSchema.optional(),
    pspFixedMinor: MinorAmountSchema.optional(),
    paymentMode: z.nativeEnum(PaymentMode).optional(),
    serviceAreaId: UuidSchema.nullable().optional(),
    /** The console's words to the owner with a listing decision; sent with the decision message. */
    listingReviewNote: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'empty update' });
export type AdminRestaurantUpdateInput = z.infer<typeof AdminRestaurantUpdateSchema>;

export const AdminRestaurantQuerySchema = z
  .object({
    query: z.string().trim().max(80).optional(),
    listed: z.enum(['true', 'false']).optional(),
    /** Only restaurants waiting for a listing decision. */
    pending: z.enum(['true']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type AdminRestaurantQuery = z.infer<typeof AdminRestaurantQuerySchema>;

export interface AdminRestaurantDTO {
  id: string;
  slug: string;
  name: string;
  countryCode: string;
  currency: string;
  city: string | null;
  district: string | null;
  serviceArea: { id: string; city: string; district: string; isLaunched: boolean } | null;
  isActive: boolean;
  isListed: boolean;
  /** Set while an overdue commission invoice keeps the restaurant out of the marketplace (docs/FATURALAMA.md). */
  listingSuspendedAt: string | null;
  listingRequestedAt: string | null;
  listingReviewedAt: string | null;
  listingReviewNote: string | null;
  /** What the console reviews before listing: how much menu there is. */
  menu: { categories: number; availableItems: number };
  commissionBps: number;
  paymentMode: `${PaymentMode}`;
  pspPercentBps: number;
  pspFixedMinor: number;
  plan: { code: PlanCode; status: `${SubscriptionStatus}`; trialEndsAt: string | null } | null;
  owner: { fullName: string; phone: string } | null;
  ordersLast7Days: number;
  createdAt: string;
}

export interface AdminRestaurantPageDTO {
  items: AdminRestaurantDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export const CreateServiceAreaSchema = z
  .object({
    countryCode: CountryCodeSchema,
    city: z.string().trim().min(2).max(80),
    district: z.string().trim().min(2).max(80),
  })
  .strict();
export type CreateServiceAreaInput = z.infer<typeof CreateServiceAreaSchema>;
export const UpdateServiceAreaSchema = z.object({ isLaunched: z.boolean() }).strict();

export interface ServiceAreaDTO {
  id: string;
  countryCode: string;
  city: string;
  district: string;
  isLaunched: boolean;
  launchedAt: string | null;
  restaurants: number;
  listedRestaurants: number;
}

export const UpdatePlanSchema = z
  .object({
    name: Name.optional(),
    monthlyPriceMinor: MinorAmountSchema.optional(),
    currency: CurrencyCodeSchema.optional(),
    trialDays: z.number().int().min(0).max(365).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'empty update' });
export type UpdatePlanInput = z.infer<typeof UpdatePlanSchema>;

export interface PlanDTO {
  id: string;
  code: PlanCode;
  name: string;
  monthlyPriceMinor: number;
  currency: string;
  isFree: boolean;
  trialDays: number;
  isActive: boolean;
  subscriptions: number;
}

export const UpsertCreditPackageSchema = z
  .object({
    code: z.string().regex(/^[a-z0-9-]{3,40}$/),
    channel: z.enum(CREDIT_CHANNELS),
    credits: z.number().int().positive().max(1_000_000),
    priceMinor: MinorAmountSchema,
    currency: CurrencyCodeSchema,
    isActive: z.boolean().default(true),
  })
  .strict();
export type UpsertCreditPackageInput = z.infer<typeof UpsertCreditPackageSchema>;

export interface AdminCreditPackageDTO extends UpsertCreditPackageInput {
  id: string;
}

export const GrantCreditsSchema = z
  .object({
    channel: z.enum(CREDIT_CHANNELS),
    credits: z.number().int().min(1).max(100_000),
    note: z.string().trim().min(2).max(200),
  })
  .strict();
export type GrantCreditsInput = z.infer<typeof GrantCreditsSchema>;

export interface GrantCreditsResultDTO {
  channel: CreditChannel;
  balance: number;
}

/** Orders per active restaurant per day by district: the phase 0 KPI (docs/YOL_HARITASI.md). */
export interface DistrictDensityDTO {
  countryCode: string;
  city: string;
  district: string;
  isLaunched: boolean;
  restaurants: number;
  listedRestaurants: number;
  orders: number;
  days: number;
  ordersPerRestaurantPerDay: number;
}

export interface AdminOverviewDTO {
  restaurants: number;
  listedRestaurants: number;
  /** Restaurants that asked to be listed and have no decision yet. */
  pendingListingRequests: number;
  activeTrials: number;
  ordersLast7Days: number;
  density: DistrictDensityDTO[];
}

/** Below this many credits a messaging provider balance counts as low (console badge, daily audit line). */
export const PROVIDER_BALANCE_WARN = 500;

export type ComponentStatus = 'ok' | 'error' | 'not_configured';

export interface ProviderBalanceDTO {
  code: string;
  /** Credits or currency units as the provider reports them; null when the provider cannot say. */
  balance: number | null;
  low: boolean;
  checkedAt: string | null;
}

/** GET /admin/system: what the platform owner looks at before anything else when something feels off. */
export interface SystemHealthDTO {
  checkedAt: string;
  release: string;
  uptimeSeconds: number;
  database: { status: ComponentStatus; latencyMs: number };
  redis: { status: ComponentStatus };
  jobs: {
    billingScheduler: 'on' | 'off';
    billingLastRunAt: string | null;
    orderWatchdog: 'on' | 'off';
  };
  providers: {
    sms: ProviderBalanceDTO;
    whatsapp: ProviderBalanceDTO;
    payment: string;
    cardVault: string;
    courier: string;
    invoice: string;
    routing: string;
  };
  activity: {
    ordersLastHour: number;
    ordersLast24h: number;
    /** PLACED orders past their acceptance deadline right now. */
    acceptanceOverdue: number;
    messagesSentLast24h: number;
    messagesFailedLast24h: number;
    openInvoices: number;
    overdueInvoices: number;
    suspendedListings: number;
    activeRestaurants: number;
  };
  /** Message credits held by all restaurants, per channel. */
  wallets: { channel: string; totalBalance: number }[];
}

export const DensityQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }).strict();

/** Super admin also needs the plan code list for the plan screen; re-exported for one import. */
export { PlanCodeSchema };
