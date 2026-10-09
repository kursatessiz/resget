import { OrderPaymentIntentSchema } from './meal-cards';
import { RedeemSessionHandoffSchema, sessionHandoffUrl } from './session-handoff';
import {
  WALLET_NAMES,
  WALLET_PROVIDERS,
  appWalletReturnSchemeUrl,
  appWalletReturnUrl,
  isWalletProvider,
  walletLinkPayload,
} from './wallets';

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

  it('sends the app back through a universal link, with the scheme as the browser fallback', () => {
    expect(appWalletReturnUrl('https://resget.example/', 'MASTERPASS')).toBe(
      'https://resget.example/uygulama/cuzdan/MASTERPASS',
    );
    expect(appWalletReturnSchemeUrl('BEX', 'mockLink=u1')).toBe('resget://uygulama/cuzdan/BEX?mockLink=u1');
    expect(appWalletReturnSchemeUrl('BEX', '')).toBe('resget://uygulama/cuzdan/BEX');
  });

  it('keeps only single string values the completion accepts as the link payload', () => {
    expect(
      walletLinkPayload({
        code: 'MASTERPASS',
        mockLink: 'u1',
        list: ['a', 'b'],
        empty: undefined,
        big: 'x'.repeat(4097),
      }),
    ).toEqual({ mockLink: 'u1' });
  });
});

describe('session handoff', () => {
  it('accepts only a 32-byte base64url code and builds the web route address', () => {
    const code = 'A'.repeat(43);
    expect(RedeemSessionHandoffSchema.safeParse({ code }).success).toBe(true);
    expect(RedeemSessionHandoffSchema.safeParse({ code: `${code}=` }).success).toBe(false);
    expect(RedeemSessionHandoffSchema.safeParse({ code: 'short' }).success).toBe(false);
    expect(sessionHandoffUrl('https://resget.example/', code, '/kebapci')).toBe(
      `https://resget.example/api/session/handoff?code=${code}&next=%2Fkebapci`,
    );
  });
});
