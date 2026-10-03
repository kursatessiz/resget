import { Injectable } from '@nestjs/common';
import { QrScanOutcome } from '@resget/database';
import type { AcceptedPaymentMethodsDTO } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MealCardsService } from '../payments/meal-cards.service';
import { notFound } from '../../common/api-error';

export interface PublicMenuDTO {
  restaurant: {
    id: string;
    slug: string;
    name: string;
    currency: string;
    logoUrl: string | null;
    themePrimary: string;
    defaultLocale: string;
  };
  table: { id: string; label: string } | null;
  /** What the guest can pay with here (docs/YEMEK_KARTI.md). */
  payment: AcceptedPaymentMethodsDTO;
  categories: {
    id: string;
    name: string;
    items: {
      id: string;
      name: string;
      description: string | null;
      priceMinor: number;
      currency: string;
      isAvailable: boolean;
      imageUrl: string | null;
    }[];
  }[];
}

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mealCards: MealCardsService,
  ) {}

  async menuOf(restaurantId: string): Promise<PublicMenuDTO['categories']> {
    const categories = await this.prisma.menuCategory.findMany({
      where: { restaurantId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        items: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            priceMinor: true,
            currency: true,
            isAvailable: true,
            imageUrl: true,
          },
        },
      },
    });
    return categories;
  }

  /**
   * The page behind a table QR. Records the VIEWED_MENU funnel event for the
   * anonymous session when one is given; never stores anything about the
   * guest beyond that.
   */
  async publicMenuByTableToken(token: string, sessionId: string | null): Promise<PublicMenuDTO> {
    const table = await this.prisma.diningTable.findUnique({
      where: { qrToken: token },
      select: {
        id: true,
        label: true,
        isActive: true,
        restaurant: {
          select: {
            id: true,
            slug: true,
            name: true,
            currency: true,
            logoUrl: true,
            themePrimary: true,
            defaultLocale: true,
            isActive: true,
          },
        },
      },
    });
    if (!table || !table.isActive || !table.restaurant.isActive) throw notFound('TABLE_NOT_FOUND', 'Table not found');
    const { isActive: _ignored, ...restaurant } = table.restaurant;
    void _ignored;
    if (sessionId) {
      await this.prisma.qrScanEvent.create({
        data: { restaurantId: restaurant.id, tableId: table.id, sessionId, outcome: QrScanOutcome.VIEWED_MENU },
      });
    }
    const [categories, payment] = await Promise.all([
      this.menuOf(restaurant.id),
      this.mealCards.acceptedMethods(restaurant.id),
    ]);
    return { restaurant, table: { id: table.id, label: table.label }, payment, categories };
  }
}
