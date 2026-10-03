import { Injectable, Logger } from '@nestjs/common';
import { PaymentConnectionStatus } from '@resget/database';
import { MEAL_CARD_PROVIDERS, isMealCardProviderCode, mealCardProvidersFor } from '@resget/shared';
import type {
  AcceptedPaymentMethodsDTO,
  MealCardConnectionDTO,
  MealCardProviderCode,
  MealCardSettingsDTO,
  UpsertMealCardConnectionInput,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsRegistry } from './payments.registry';
import { MealCardsRegistry } from './meal-cards.registry';
import { conflict, notFound } from '../../common/api-error';

/**
 * Which meal cards a restaurant takes and how (docs/YEMEK_KARTI.md). Issuer
 * credentials follow the own-POS rules: verified with the issuer, encrypted
 * at rest, never returned.
 */
@Injectable()
export class MealCardsService {
  private readonly logger = new Logger(MealCardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsRegistry,
    private readonly registry: MealCardsRegistry,
  ) {}

  async settings(restaurantId: string): Promise<MealCardSettingsDTO> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { countryCode: true },
    });
    if (!restaurant) throw notFound('NOT_FOUND', 'Restaurant not found');
    const rows = await this.prisma.mealCardConnection.findMany({
      where: { restaurantId },
      orderBy: { providerCode: 'asc' },
    });
    return {
      catalog: mealCardProvidersFor(restaurant.countryCode, this.registry.includeMock).map((code) => ({
        providerCode: code,
        name: MEAL_CARD_PROVIDERS[code].name,
        onlineAvailable: this.registry.has(code),
      })),
      connections: rows.filter((r) => isMealCardProviderCode(r.providerCode)).map((r) => this.toDto(r)),
    };
  }

  async upsert(restaurantId: string, input: UpsertMealCardConnectionInput): Promise<MealCardSettingsDTO> {
    let encryptedCredentials: string | null = null;
    let keyVersion: string | null = null;
    let status: PaymentConnectionStatus = PaymentConnectionStatus.DISABLED;
    let label: string | null = null;
    let failureReason: string | null = null;
    let lastVerifiedAt: Date | null = null;

    if (input.acceptsOnline) {
      const adapter = this.registry.get(input.providerCode);
      if (!adapter) {
        throw conflict('MEAL_CARD_PROVIDER_UNAVAILABLE', `No online adapter for ${input.providerCode} yet`);
      }
      const credentials = input.credentials ?? {};
      const verification = await adapter.verifyCredentials(credentials);
      encryptedCredentials = this.payments.cipher.encryptJson(credentials);
      keyVersion = this.payments.cipher.keyVersion;
      status = verification.ok ? PaymentConnectionStatus.ACTIVE : PaymentConnectionStatus.FAILED;
      label = verification.ok ? verification.label : MEAL_CARD_PROVIDERS[input.providerCode].name;
      failureReason = verification.ok ? null : (verification.reason ?? 'verification failed');
      lastVerifiedAt = verification.ok ? new Date() : null;
      if (!verification.ok) {
        this.logger.warn(`Meal card verification failed for restaurant ${restaurantId} (${input.providerCode})`);
      }
    }

    const data = {
      acceptsOnline: input.acceptsOnline,
      acceptsOnDelivery: input.acceptsOnDelivery,
      encryptedCredentials,
      keyVersion,
      status,
      label,
      failureReason,
      lastVerifiedAt,
    };
    await this.prisma.mealCardConnection.upsert({
      where: { restaurantId_providerCode: { restaurantId, providerCode: input.providerCode } },
      create: { restaurantId, providerCode: input.providerCode, ...data },
      update: data,
    });
    return this.settings(restaurantId);
  }

  async remove(restaurantId: string, providerCode: MealCardProviderCode): Promise<MealCardSettingsDTO> {
    await this.prisma.mealCardConnection.deleteMany({ where: { restaurantId, providerCode } });
    return this.settings(restaurantId);
  }

  /** What a checkout may offer. Public data: issuer names only. */
  async acceptedMethods(restaurantId: string): Promise<AcceptedPaymentMethodsDTO> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: {
        paymentMode: true,
        paymentConnection: { select: { status: true } },
        mealCardConnections: {
          select: { providerCode: true, acceptsOnline: true, acceptsOnDelivery: true, status: true },
          // A stable order for the checkout and for anyone comparing two reads; row order is not a contract.
          orderBy: { providerCode: 'asc' },
        },
      },
    });
    if (!restaurant) throw notFound('NOT_FOUND', 'Restaurant not found');
    const cards = restaurant.mealCardConnections.filter((c) => isMealCardProviderCode(c.providerCode));
    const entry = (code: string) => ({
      providerCode: code as MealCardProviderCode,
      name: MEAL_CARD_PROVIDERS[code as MealCardProviderCode].name,
    });
    return {
      onlineCard:
        restaurant.paymentMode === 'PLATFORM_PSP' ||
        restaurant.paymentConnection?.status === PaymentConnectionStatus.ACTIVE,
      mealCardsOnline: cards
        .filter((c) => c.acceptsOnline && c.status === PaymentConnectionStatus.ACTIVE)
        .map((c) => entry(c.providerCode)),
      // Cash and card at the door stay open in phase 0 (HANDOVER open question); a restaurant switch follows with A3.
      cashOnDelivery: true,
      cardOnDelivery: true,
      mealCardsOnDelivery: cards.filter((c) => c.acceptsOnDelivery).map((c) => entry(c.providerCode)),
    };
  }

  /** Decrypted issuer credentials of an online-active connection, for the checkout and webhook paths only. */
  async onlineCredentials(
    connectionId: string,
  ): Promise<{ restaurantId: string; providerCode: MealCardProviderCode; credentials: Record<string, string> } | null> {
    const row = await this.prisma.mealCardConnection.findUnique({ where: { id: connectionId } });
    if (!row || !row.acceptsOnline || row.status !== PaymentConnectionStatus.ACTIVE || !row.encryptedCredentials) {
      return null;
    }
    if (!isMealCardProviderCode(row.providerCode)) return null;
    return {
      restaurantId: row.restaurantId,
      providerCode: row.providerCode,
      credentials: this.payments.cipher.decryptJson(row.encryptedCredentials),
    };
  }

  async onlineConnectionFor(restaurantId: string, providerCode: string): Promise<string | null> {
    const row = await this.prisma.mealCardConnection.findFirst({
      where: { restaurantId, providerCode, acceptsOnline: true, status: PaymentConnectionStatus.ACTIVE },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  private toDto(row: {
    providerCode: string;
    acceptsOnline: boolean;
    acceptsOnDelivery: boolean;
    status: PaymentConnectionStatus;
    label: string | null;
    lastVerifiedAt: Date | null;
    failureReason: string | null;
  }): MealCardConnectionDTO {
    const code = row.providerCode as MealCardProviderCode;
    return {
      providerCode: code,
      name: MEAL_CARD_PROVIDERS[code].name,
      acceptsOnline: row.acceptsOnline,
      acceptsOnDelivery: row.acceptsOnDelivery,
      status: row.status,
      label: row.label,
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
      failureReason: row.failureReason,
    };
  }
}
