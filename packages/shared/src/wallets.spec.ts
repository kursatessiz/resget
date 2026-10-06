import { OrderPaymentIntentSchema } from './meal-cards';
import { WALLET_NAMES, WALLET_PROVIDERS, isWalletProvider } from './wallets';

describe('platform wallets', () => {
  it('knows Masterpass and bex by code, each with its brand name', () => {
    expect(WALLET_PROVIDERS).toEqual(['MASTERPASS', 'BEX']);
    expect(WALLET_NAMES.BEX).toBe('bex');
    expect(isWalletProvider('MASTERPASS')).toBe(true);
    expect(isWalletProvider('MOCK')).toBe(false);
  });

  it('takes a wallet card only with an online card payment', () => {
    const id = '7b4a7a4e-2b1d-4f7e-9e0a-0c6f6f2b1a11';
    expect(OrderPaymentIntentSchema.safeParse({ method: 'ONLINE_CARD', savedPaymentMethodId: id }).success).toBe(true);
    expect(OrderPaymentIntentSchema.safeParse({ method: 'CASH_ON_DELIVERY', savedPaymentMethodId: id }).success).toBe(
      false,
    );
    expect(OrderPaymentIntentSchema.safeParse({ method: 'ONLINE_CARD', savedPaymentMethodId: 'x' }).success).toBe(
      false,
    );
  });
});
