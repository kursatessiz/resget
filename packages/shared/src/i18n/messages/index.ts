import { trCommon } from './tr/common';
import { trNav } from './tr/nav';
import { trAuth } from './tr/auth';
import { trErrors } from './tr/errors';
import { trOrders } from './tr/orders';
import { trMenu } from './tr/menu';
import { trQr } from './tr/qr';
import { trPlans } from './tr/plans';
import { trCourier } from './tr/courier';
import { trSettlement } from './tr/settlement';
import { trPermissions } from './tr/permissions';
import { trLanding } from './tr/landing';
import { trPayments } from './tr/payments';
import { trDispatch } from './tr/dispatch';
import { trTracking } from './tr/tracking';
import { trFeatures } from './tr/features';
import { trPanel } from './tr/panel';
import { trTables } from './tr/tables';
import { trSettings } from './tr/settings';
import { trStaff } from './tr/staff';
import { trMessaging } from './tr/messaging';
import { trSignup } from './tr/signup';
import { trAdmin } from './tr/admin';
import { trShop } from './tr/shop';
import { trBilling } from './tr/billing';
import { trCustomers } from './tr/customers';
import { trReports } from './tr/reports';
import { trCampaigns } from './tr/campaigns';
import { trAccount } from './tr/account';
import { trFinance } from './tr/finance';
import { trMobile } from './tr/mobile';
import { trLoyalty } from './tr/loyalty';
import { trCoupons } from './tr/coupons';
import { trIntegrations } from './tr/integrations';
import { enCommon } from './en/common';
import { enNav } from './en/nav';
import { enAuth } from './en/auth';
import { enErrors } from './en/errors';
import { enOrders } from './en/orders';
import { enMenu } from './en/menu';
import { enQr } from './en/qr';
import { enPlans } from './en/plans';
import { enCourier } from './en/courier';
import { enSettlement } from './en/settlement';
import { enPermissions } from './en/permissions';
import { enLanding } from './en/landing';
import { enPayments } from './en/payments';
import { enDispatch } from './en/dispatch';
import { enTracking } from './en/tracking';
import { enFeatures } from './en/features';
import { enPanel } from './en/panel';
import { enTables } from './en/tables';
import { enSettings } from './en/settings';
import { enStaff } from './en/staff';
import { enMessaging } from './en/messaging';
import { enSignup } from './en/signup';
import { enAdmin } from './en/admin';
import { enShop } from './en/shop';
import { enBilling } from './en/billing';
import { enCustomers } from './en/customers';
import { enReports } from './en/reports';
import { enCampaigns } from './en/campaigns';
import { enAccount } from './en/account';
import { enFinance } from './en/finance';
import { enMobile } from './en/mobile';
import { enLoyalty } from './en/loyalty';
import { enCoupons } from './en/coupons';
import { enIntegrations } from './en/integrations';

/**
 * Bundled message catalogues. Adding strings:
 * 1. put the Turkish text in messages/tr/<namespace>.ts (keys start with
 *    "<namespace>."), 2. add the English text in messages/en/<namespace>.ts
 *    (typed against the Turkish file, so a missing English key is a compile
 *    error), 3. add one line to each list below. The spec checks that both
 *    lists cover the same keys and that no key appears in two namespaces.
 *    Other languages come from uploaded language packs.
 */
export const TR_NAMESPACES = [
  trCommon,
  trNav,
  trAuth,
  trErrors,
  trOrders,
  trMenu,
  trQr,
  trPlans,
  trCourier,
  trSettlement,
  trPermissions,
  trLanding,
  trPayments,
  trDispatch,
  trTracking,
  trFeatures,
  trPanel,
  trTables,
  trSettings,
  trStaff,
  trMessaging,
  trSignup,
  trAdmin,
  trShop,
  trBilling,
  trCustomers,
  trReports,
  trCampaigns,
  trAccount,
  trFinance,
  trLoyalty,
  trCoupons,
  trIntegrations,
  trMobile,
] as const;

export const EN_NAMESPACES = [
  enCommon,
  enNav,
  enAuth,
  enErrors,
  enOrders,
  enMenu,
  enQr,
  enPlans,
  enCourier,
  enSettlement,
  enPermissions,
  enLanding,
  enPayments,
  enDispatch,
  enTracking,
  enFeatures,
  enPanel,
  enTables,
  enSettings,
  enStaff,
  enMessaging,
  enSignup,
  enAdmin,
  enShop,
  enBilling,
  enCustomers,
  enReports,
  enCampaigns,
  enAccount,
  enFinance,
  enLoyalty,
  enCoupons,
  enIntegrations,
  enMobile,
] as const;

type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (arg: infer I) => void ? I : never;
type MergedCatalogue = UnionToIntersection<(typeof TR_NAMESPACES)[number]>;

export const BASE_MESSAGES: Readonly<MergedCatalogue> = Object.freeze(
  Object.assign({}, ...TR_NAMESPACES) as MergedCatalogue,
);
export type MessageKey = keyof MergedCatalogue;

const EN_MESSAGES: Readonly<Record<MessageKey, string>> = Object.freeze(
  Object.assign({}, ...EN_NAMESPACES) as Record<MessageKey, string>,
);

export const BUNDLED_MESSAGES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  tr: BASE_MESSAGES,
  en: EN_MESSAGES,
});

/** Languages whose messages ship with the code; the API creates their rows on boot. */
export const BUNDLED_LANGUAGES = [
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'en', name: 'English', nativeName: 'English' },
] as const;
