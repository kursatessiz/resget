import { Injectable } from '@nestjs/common';
import { WALLET_NAMES, isWalletProvider } from '@resget/shared';
import type {
  SavedPaymentMethodDTO,
  WalletDTO,
  WalletLinkStartDTO,
  WalletProviderCode,
  WalletsDTO,
} from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PaymentsRegistry } from './payments.registry';
import { PaymentsService } from './payments.service';
import { MealCardsService } from './meal-cards.service';
import { conflict, notFound } from '../../common/api-error';

/**
 * Platform wallets (docs/CUZDAN.md): the customer links Masterpass or bex
 * once; a restaurant the platform collects for takes the saved card. The
 * wallet keeps the card, the platform keeps only the encrypted token.
 */
@Injectable()
export class WalletsService {
  constructor(
    private readonly features: FeatureFlagsService,
    private readonly registry: PaymentsRegistry,
    private readonly payments: PaymentsService,
    private readonly mealCards: MealCardsService,
  ) {}

  /** Wallets a customer may link: the module's global switch and an adapter for each. */
  async offered(): Promise<WalletDTO[]> {
    if (!(await this.features.isEnabled('platform_wallets', null))) return [];
    return this.registry.walletCodes().map((code) => ({ code, name: WALLET_NAMES[code] }));
  }

  async list(userId: string): Promise<WalletsDTO> {
    const [wallets, cards] = await Promise.all([this.offered(), this.payments.listSavedCards(userId)]);
    return { wallets, cards: cards.filter((card) => isWalletProvider(card.provider)) };
  }

  async beginLink(userId: string, code: WalletProviderCode, returnUrl: string): Promise<WalletLinkStartDTO> {
    return this.adapterOf(code, await this.offered()).beginLink(userId, returnUrl);
  }

  async completeLink(userId: string, code: WalletProviderCode, payload: Record<string, string>): Promise<WalletsDTO> {
    await this.payments.completeCardLink(userId, payload, this.adapterOf(code, await this.offered()));
    return this.list(userId);
  }

  /** The customer's wallet cards the restaurant accepts, for the ordering page. */
  async usableCardsAt(userId: string, restaurantId: string): Promise<SavedPaymentMethodDTO[]> {
    const accepted = (await this.mealCards.acceptedMethods(restaurantId)).wallets.map((w) => w.code);
    if (accepted.length === 0) return [];
    const cards = await this.payments.listSavedCards(userId);
    return cards.filter((card) => (accepted as readonly string[]).includes(card.provider));
  }

  /** Refuses a wallet card the signed-in customer does not own or the restaurant does not take. */
  async assertUsable(restaurantId: string, userId: string | null, savedPaymentMethodId: string): Promise<void> {
    if (!userId) throw conflict('WALLET_SIGN_IN_REQUIRED', 'Sign in to pay with a wallet card');
    const usable = await this.usableCardsAt(userId, restaurantId);
    if (!usable.some((card) => card.id === savedPaymentMethodId)) {
      throw conflict('WALLET_UNAVAILABLE', 'This wallet card cannot be used here');
    }
  }

  private adapterOf(code: WalletProviderCode, offered: WalletDTO[]) {
    const adapter = offered.some((w) => w.code === code) ? this.registry.wallet(code) : null;
    if (!adapter) throw notFound('NOT_FOUND', `${code} is not offered`);
    return adapter;
  }
}
