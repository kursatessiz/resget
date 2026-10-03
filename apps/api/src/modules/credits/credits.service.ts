import { Injectable } from '@nestjs/common';
import type { CreditChannel, PurchaseCreditsInput, PurchaseCreditsResultDTO } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { PaymentsRegistry } from '../payments/payments.registry';
import { notFound } from '../../common/api-error';

/**
 * Credit packages are bought with the buyer's saved card through the card
 * vault; the platform never sees a number. Credits land in the wallet when
 * the charge is captured. A 3-D Secure challenge returns through the vault's
 * callback (docs/ODEME.md); until a real vault is wired, MOCK captures at once.
 */
@Injectable()
export class CreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly registry: PaymentsRegistry,
  ) {}

  async purchase(
    restaurantId: string,
    buyerUserId: string,
    input: PurchaseCreditsInput,
  ): Promise<PurchaseCreditsResultDTO> {
    const [pkg, restaurant, card] = await Promise.all([
      this.prisma.messageCreditPackage.findFirst({ where: { code: input.packageCode, isActive: true } }),
      this.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { currency: true } }),
      this.prisma.savedPaymentMethod.findFirst({
        where: { id: input.paymentMethodId, userId: buyerUserId },
        select: { id: true, encryptedToken: true },
      }),
    ]);
    if (!pkg || pkg.currency !== restaurant.currency) throw notFound('PACKAGE_NOT_FOUND', 'Package not found');
    if (!card) throw notFound('PAYMENT_METHOD_NOT_FOUND', 'Saved card not found');

    const result = await this.registry.vault.charge({
      token: this.registry.cipher.decrypt(card.encryptedToken),
      amountMinor: pkg.priceMinor,
      currency: pkg.currency,
      merchantRef: 'platform',
      orderRef: `credits:${restaurantId}:${pkg.code}:${Date.now()}`,
      returnUrl: input.returnUrl,
    });
    if (result.status !== 'CAPTURED') {
      return {
        status: result.status,
        redirectUrl: result.redirectUrl,
        failureCode: result.failureCode,
        wallets: await this.messaging.wallets(restaurantId),
      };
    }
    const wallets = await this.messaging.grant(
      restaurantId,
      pkg.channel as CreditChannel,
      pkg.credits,
      'PURCHASE',
      `${pkg.code}:${result.providerRef ?? 'captured'}`,
    );
    return { status: 'CAPTURED', redirectUrl: null, failureCode: null, wallets };
  }
}
