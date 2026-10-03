import {
  MEAL_CARD_PROVIDERS,
  OrderPaymentIntentSchema,
  UpsertMealCardConnectionSchema,
  effectivePaymentModeFor,
  isPaidBeforePlacement,
  mealCardProvidersFor,
} from './meal-cards';
import { BASE_MESSAGES } from './i18n/messages';

describe('meal card catalogue', () => {
  it('lists the Turkish issuers for a Turkish restaurant and hides the mock outside development', () => {
    const tr = mealCardProvidersFor('tr', false);
    expect(tr).toEqual(
      expect.arrayContaining([
        'MULTINET',
        'EDENRED',
        'PLUXEE',
        'SETCARD',
        'METROPOL',
        'YEMEKMATIK',
        'PAYE',
        'TOKENFLEX',
      ]),
    );
    expect(tr).not.toContain('MOCK');
    expect(mealCardProvidersFor('TR', true)).toContain('MOCK');
    expect(mealCardProvidersFor('DE', false)).toEqual([]);
  });

  it('has a name for every issuer and a label for every payment method', () => {
    for (const spec of Object.values(MEAL_CARD_PROVIDERS)) expect(spec.name.length).toBeGreaterThan(0);
    for (const method of ['ONLINE_CARD', 'CASH_ON_DELIVERY', 'CARD_ON_DELIVERY', 'MEAL_CARD']) {
      expect(BASE_MESSAGES[`payments.method.${method}` as keyof typeof BASE_MESSAGES]).toBeTruthy();
    }
  });
});

describe('meal card connection input', () => {
  it('needs credentials only for online acceptance and refuses unknown fields', () => {
    expect(UpsertMealCardConnectionSchema.safeParse({ providerCode: 'MULTINET' }).success).toBe(true);
    expect(UpsertMealCardConnectionSchema.safeParse({ providerCode: 'MULTINET', acceptsOnline: true }).success).toBe(
      false,
    );
    const ok = UpsertMealCardConnectionSchema.safeParse({
      providerCode: 'MULTINET',
      acceptsOnline: true,
      credentials: { merchantId: 'm1', apiKey: 'k', apiSecret: 's', terminalId: 't' },
    });
    expect(ok.success).toBe(true);
    const unknown = UpsertMealCardConnectionSchema.safeParse({
      providerCode: 'MULTINET',
      acceptsOnline: true,
      credentials: { merchantId: 'm1', apiKey: 'k', apiSecret: 's', password: 'x' },
    });
    expect(unknown.success).toBe(false);
    expect(
      UpsertMealCardConnectionSchema.safeParse({
        providerCode: 'EDENRED',
        acceptsOnline: false,
        acceptsOnDelivery: false,
      }).success,
    ).toBe(false);
  });
});

describe('payment intent and settlement mode', () => {
  it('requires an issuer for a meal card', () => {
    expect(OrderPaymentIntentSchema.safeParse({ method: 'MEAL_CARD' }).success).toBe(false);
    expect(OrderPaymentIntentSchema.safeParse({ method: 'MEAL_CARD', providerCode: 'PLUXEE' }).success).toBe(true);
    expect(OrderPaymentIntentSchema.safeParse({ method: 'CASH_ON_DELIVERY' }).success).toBe(true);
  });

  it('waits for payment only when the money moves before the kitchen starts', () => {
    expect(isPaidBeforePlacement({ method: 'ONLINE_CARD' }, false)).toBe(true);
    expect(isPaidBeforePlacement({ method: 'CASH_ON_DELIVERY' }, false)).toBe(false);
    expect(isPaidBeforePlacement({ method: 'MEAL_CARD', providerCode: 'MULTINET' }, true)).toBe(true);
    expect(isPaidBeforePlacement({ method: 'MEAL_CARD', providerCode: 'MULTINET' }, false)).toBe(false);
    expect(isPaidBeforePlacement({ method: 'MEAL_CARD', providerCode: 'MULTINET', atDoor: true }, true)).toBe(false);
  });

  it('settles everything the restaurant collects itself like OWN_POS', () => {
    expect(effectivePaymentModeFor('ONLINE_CARD', 'PLATFORM_PSP')).toBe('PLATFORM_PSP');
    expect(effectivePaymentModeFor(null, 'PLATFORM_PSP')).toBe('PLATFORM_PSP');
    expect(effectivePaymentModeFor('MEAL_CARD', 'PLATFORM_PSP')).toBe('OWN_POS');
    expect(effectivePaymentModeFor('CASH_ON_DELIVERY', 'PLATFORM_PSP')).toBe('OWN_POS');
    expect(effectivePaymentModeFor('CARD_ON_DELIVERY', 'OWN_POS')).toBe('OWN_POS');
  });
});
