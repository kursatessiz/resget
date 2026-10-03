import { Injectable } from '@nestjs/common';
import { Prisma, QrScanOutcome } from '@resget/database';
import type {
  AcceptedPaymentMethodsDTO,
  CreateMenuCategoryInput,
  CreateMenuItemInput,
  MenuAdminDTO,
  MenuCategoryAdminDTO,
  MenuItemAdminDTO,
  ReplaceModifierGroupsInput,
  UpdateMenuCategoryInput,
  UpdateMenuItemInput,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MealCardsService } from '../payments/meal-cards.service';
import { badRequest, conflict, notFound } from '../../common/api-error';

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

const adminItemSelect = Prisma.validator<Prisma.MenuItemSelect>()({
  id: true,
  categoryId: true,
  name: true,
  description: true,
  priceMinor: true,
  currency: true,
  vatRateBps: true,
  imageUrl: true,
  isAvailable: true,
  sortOrder: true,
  modifierGroups: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      minSelect: true,
      maxSelect: true,
      sortOrder: true,
      modifiers: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, priceDeltaMinor: true, isAvailable: true, sortOrder: true },
      },
    },
  },
});

const adminCategorySelect = Prisma.validator<Prisma.MenuCategorySelect>()({
  id: true,
  name: true,
  sortOrder: true,
  isActive: true,
  items: { orderBy: { sortOrder: 'asc' }, select: adminItemSelect },
});

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

  // -- Management (menu.manage) -------------------------------------------------------

  /** Everything, including hidden categories and sold-out items, in display order. */
  async adminMenu(restaurantId: string): Promise<MenuAdminDTO> {
    const [restaurant, categories] = await Promise.all([
      this.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { currency: true } }),
      this.prisma.menuCategory.findMany({
        where: { restaurantId },
        orderBy: { sortOrder: 'asc' },
        select: adminCategorySelect,
      }),
    ]);
    return { currency: restaurant.currency, categories };
  }

  async createCategory(restaurantId: string, input: CreateMenuCategoryInput): Promise<MenuCategoryAdminDTO> {
    const sortOrder = input.sortOrder ?? (await this.nextCategoryOrder(restaurantId));
    return this.prisma.menuCategory.create({
      data: { restaurantId, name: input.name, sortOrder },
      select: adminCategorySelect,
    });
  }

  async updateCategory(
    restaurantId: string,
    categoryId: string,
    input: UpdateMenuCategoryInput,
  ): Promise<MenuCategoryAdminDTO> {
    await this.requireCategory(restaurantId, categoryId);
    return this.prisma.menuCategory.update({ where: { id: categoryId }, data: input, select: adminCategorySelect });
  }

  /** A category is deleted only when empty; items carry order history and are never dropped by accident. */
  async deleteCategory(restaurantId: string, categoryId: string): Promise<void> {
    await this.requireCategory(restaurantId, categoryId);
    const items = await this.prisma.menuItem.count({ where: { categoryId } });
    if (items > 0) throw conflict('MENU_CATEGORY_NOT_EMPTY', 'Category still has items');
    await this.prisma.menuCategory.delete({ where: { id: categoryId } });
  }

  async reorderCategories(restaurantId: string, ids: string[]): Promise<MenuAdminDTO> {
    const existing = await this.prisma.menuCategory.findMany({ where: { restaurantId }, select: { id: true } });
    this.assertSameSet(
      existing.map((c) => c.id),
      ids,
    );
    await this.prisma.$transaction(
      ids.map((id, index) => this.prisma.menuCategory.update({ where: { id }, data: { sortOrder: index + 1 } })),
    );
    return this.adminMenu(restaurantId);
  }

  async createItem(restaurantId: string, input: CreateMenuItemInput): Promise<MenuItemAdminDTO> {
    await this.requireCategory(restaurantId, input.categoryId);
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { currency: true },
    });
    const sortOrder = input.sortOrder ?? (await this.nextItemOrder(input.categoryId));
    return this.prisma.menuItem.create({
      data: {
        restaurantId,
        categoryId: input.categoryId,
        name: input.name,
        description: input.description ?? null,
        priceMinor: input.priceMinor,
        currency: restaurant.currency,
        vatRateBps: input.vatRateBps,
        imageUrl: input.imageUrl ?? null,
        isAvailable: input.isAvailable ?? true,
        sortOrder,
      },
      select: adminItemSelect,
    });
  }

  async updateItem(restaurantId: string, itemId: string, input: UpdateMenuItemInput): Promise<MenuItemAdminDTO> {
    await this.requireItem(restaurantId, itemId);
    if (input.categoryId) await this.requireCategory(restaurantId, input.categoryId);
    return this.prisma.menuItem.update({ where: { id: itemId }, data: input, select: adminItemSelect });
  }

  /** An item that appears in any order stays (mark it sold out instead); order lines keep their snapshot either way. */
  async deleteItem(restaurantId: string, itemId: string): Promise<void> {
    await this.requireItem(restaurantId, itemId);
    const used = await this.prisma.orderItem.count({ where: { menuItemId: itemId } });
    if (used > 0) throw conflict('MENU_ITEM_IN_USE', 'Item is referenced by orders');
    await this.prisma.menuItem.delete({ where: { id: itemId } });
  }

  async reorderItems(restaurantId: string, categoryId: string, ids: string[]): Promise<MenuCategoryAdminDTO> {
    await this.requireCategory(restaurantId, categoryId);
    const existing = await this.prisma.menuItem.findMany({ where: { categoryId }, select: { id: true } });
    this.assertSameSet(
      existing.map((i) => i.id),
      ids,
    );
    await this.prisma.$transaction(
      ids.map((id, index) => this.prisma.menuItem.update({ where: { id }, data: { sortOrder: index + 1 } })),
    );
    return this.prisma.menuCategory.findUniqueOrThrow({ where: { id: categoryId }, select: adminCategorySelect });
  }

  /** Replaces the option groups of an item as a whole, in the order given. */
  async replaceModifierGroups(
    restaurantId: string,
    itemId: string,
    input: ReplaceModifierGroupsInput,
  ): Promise<MenuItemAdminDTO> {
    await this.requireItem(restaurantId, itemId);
    await this.prisma.$transaction(async (tx) => {
      await tx.modifierGroup.deleteMany({ where: { menuItemId: itemId } });
      for (const [groupIndex, group] of input.groups.entries()) {
        await tx.modifierGroup.create({
          data: {
            menuItemId: itemId,
            name: group.name,
            minSelect: group.minSelect,
            maxSelect: group.maxSelect,
            sortOrder: groupIndex + 1,
            modifiers: {
              create: group.modifiers.map((modifier, index) => ({
                name: modifier.name,
                priceDeltaMinor: modifier.priceDeltaMinor,
                isAvailable: modifier.isAvailable,
                sortOrder: index + 1,
              })),
            },
          },
        });
      }
    });
    return this.prisma.menuItem.findUniqueOrThrow({ where: { id: itemId }, select: adminItemSelect });
  }

  private async requireCategory(restaurantId: string, categoryId: string): Promise<void> {
    const category = await this.prisma.menuCategory.findFirst({
      where: { id: categoryId, restaurantId },
      select: { id: true },
    });
    if (!category) throw notFound('MENU_CATEGORY_NOT_FOUND', 'Category not found');
  }

  private async requireItem(restaurantId: string, itemId: string): Promise<void> {
    const item = await this.prisma.menuItem.findFirst({ where: { id: itemId, restaurantId }, select: { id: true } });
    if (!item) throw notFound('MENU_ITEM_NOT_FOUND', 'Item not found');
  }

  private async nextCategoryOrder(restaurantId: string): Promise<number> {
    const last = await this.prisma.menuCategory.aggregate({ where: { restaurantId }, _max: { sortOrder: true } });
    return (last._max.sortOrder ?? 0) + 1;
  }

  private async nextItemOrder(categoryId: string): Promise<number> {
    const last = await this.prisma.menuItem.aggregate({ where: { categoryId }, _max: { sortOrder: true } });
    return (last._max.sortOrder ?? 0) + 1;
  }

  private assertSameSet(existing: string[], ids: string[]): void {
    const wanted = new Set(ids);
    if (wanted.size !== ids.length || existing.length !== ids.length || existing.some((id) => !wanted.has(id))) {
      throw badRequest('REORDER_MISMATCH', 'Reorder list does not match the current rows');
    }
  }
}
