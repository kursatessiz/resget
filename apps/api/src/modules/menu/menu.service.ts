import { Injectable } from '@nestjs/common';
import { Prisma } from '@resget/database';
import {
  OpeningHoursSchema,
  allergensFrom,
  categoryServedAt,
  dietaryTagsFrom,
  menuMatchKey,
  parseMenuCsv,
} from '@resget/shared';
import type { OpeningHours } from '@resget/shared';
import type {
  CreateMenuCategoryInput,
  ImportMenuInput,
  MenuImportResultDTO,
  CreateMenuItemInput,
  MenuAdminDTO,
  MenuCategoryAdminDTO,
  MenuItemAdminDTO,
  MenuItemWebhookData,
  MenuWebhookData,
  ReplaceModifierGroupsInput,
  UpdateMenuCategoryInput,
  StorefrontCategoryDTO,
  UpdateMenuItemInput,
} from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { badRequest, conflict, notFound } from '../../common/api-error';

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
  allergens: true,
  dietaryTags: true,
  stockQuantity: true,
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
  availableHours: true,
  kitchenStation: true,
  items: { orderBy: { sortOrder: 'asc' }, select: adminItemSelect },
});

type AdminItemRow = Prisma.MenuItemGetPayload<{ select: typeof adminItemSelect }>;
type AdminCategoryRow = Prisma.MenuCategoryGetPayload<{ select: typeof adminCategorySelect }>;

/** Stored tag columns are plain strings; the DTO carries only known values, in catalogue order. */
function toItem(row: AdminItemRow): MenuItemAdminDTO {
  return { ...row, allergens: allergensFrom(row.allergens), dietaryTags: dietaryTagsFrom(row.dietaryTags) };
}

/** Stored windows, read leniently: anything that is not valid opening hours counts as none (always served). */
function hoursOf(raw: unknown): OpeningHours | null {
  const parsed = OpeningHoursSchema.safeParse(raw);
  return raw !== null && parsed.success ? parsed.data : null;
}

/** Prisma writes a JSON null as DbNull; undefined leaves the column alone. */
function hoursInput(hours: OpeningHours | null | undefined) {
  if (hours === undefined) return undefined;
  return hours === null ? Prisma.DbNull : (hours as Prisma.InputJsonValue);
}

function toCategory(row: AdminCategoryRow): MenuCategoryAdminDTO {
  return { ...row, availableHours: hoursOf(row.availableHours), items: row.items.map(toItem) };
}

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
    private readonly webhooks: WebhooksService,
  ) {}

  // -- Webhooks (docs/API_ERISIMI.md): staff edits are pushed to the restaurant's systems; enqueueing never throws.

  private async itemChanged(
    restaurantId: string,
    change: MenuItemWebhookData['change'],
    itemId: string,
    item: MenuItemAdminDTO | null,
  ): Promise<void> {
    const data: MenuItemWebhookData = { change, itemId, item };
    await this.webhooks.enqueue(restaurantId, 'menu.item.updated', data);
  }

  private async menuChanged(
    restaurantId: string,
    change: MenuWebhookData['change'],
    categoryId: string | null,
  ): Promise<void> {
    const data: MenuWebhookData = { change, categoryId };
    await this.webhooks.enqueue(restaurantId, 'menu.updated', data);
  }

  /** The guest-facing menu: visible categories, every item with its available option groups. */
  async menuOf(restaurantId: string): Promise<StorefrontCategoryDTO[]> {
    const categories = await this.prisma.menuCategory.findMany({
      where: { restaurantId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        availableHours: true,
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
            allergens: true,
            dietaryTags: true,
            stockQuantity: true,
            modifierGroups: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                name: true,
                minSelect: true,
                maxSelect: true,
                sortOrder: true,
                modifiers: {
                  where: { isAvailable: true },
                  orderBy: { sortOrder: 'asc' },
                  select: { id: true, name: true, priceDeltaMinor: true, isAvailable: true, sortOrder: true },
                },
              },
            },
          },
        },
      },
    });
    // Allergens and tags reach guests only while the module is on (docs/ALERJENLER.md).
    const [withTags, withDayparts, withStock] = await Promise.all([
      this.features.isEnabled('allergens', restaurantId),
      this.features.isEnabled('menu_dayparts', restaurantId),
      this.features.isEnabled('menu_stock', restaurantId),
    ]);
    return categories.map((category) => ({
      ...category,
      // Ordering windows reach guests only while the module is on (docs/OGUN_SAATLERI.md).
      availableHours: withDayparts ? hoursOf(category.availableHours) : null,
      items: category.items.map(({ stockQuantity, ...item }) => {
        // A counted item at zero is sold out until the restaurant restocks it (docs/STOK.md).
        const counted = withStock && stockQuantity !== null;
        return {
          ...item,
          isAvailable: item.isAvailable && !(counted && stockQuantity <= 0),
          allergens: withTags ? allergensFrom(item.allergens) : [],
          dietaryTags: withTags ? dietaryTagsFrom(item.dietaryTags) : [],
          stockLeft: counted ? stockQuantity : null,
        };
      }),
    }));
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
    return { currency: restaurant.currency, categories: categories.map(toCategory) };
  }

  async createCategory(restaurantId: string, input: CreateMenuCategoryInput): Promise<MenuCategoryAdminDTO> {
    const sortOrder = input.sortOrder ?? (await this.nextCategoryOrder(restaurantId));
    const created = toCategory(
      await this.prisma.menuCategory.create({
        data: {
          restaurantId,
          name: input.name,
          sortOrder,
          availableHours: hoursInput(input.availableHours),
          kitchenStation: input.kitchenStation ?? null,
        },
        select: adminCategorySelect,
      }),
    );
    await this.menuChanged(restaurantId, 'CATEGORY_CREATED', created.id);
    return created;
  }

  async updateCategory(
    restaurantId: string,
    categoryId: string,
    input: UpdateMenuCategoryInput,
  ): Promise<MenuCategoryAdminDTO> {
    await this.requireCategory(restaurantId, categoryId);
    const updated = toCategory(
      await this.prisma.menuCategory.update({
        where: { id: categoryId },
        data: { ...input, availableHours: hoursInput(input.availableHours) },
        select: adminCategorySelect,
      }),
    );
    await this.menuChanged(restaurantId, 'CATEGORY_UPDATED', categoryId);
    return updated;
  }

  /** A category is deleted only when empty; items carry order history and are never dropped by accident. */
  async deleteCategory(restaurantId: string, categoryId: string): Promise<void> {
    await this.requireCategory(restaurantId, categoryId);
    const items = await this.prisma.menuItem.count({ where: { categoryId } });
    if (items > 0) throw conflict('MENU_CATEGORY_NOT_EMPTY', 'Category still has items');
    await this.prisma.menuCategory.delete({ where: { id: categoryId } });
    await this.menuChanged(restaurantId, 'CATEGORY_DELETED', categoryId);
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
    await this.menuChanged(restaurantId, 'CATEGORIES_REORDERED', null);
    return this.adminMenu(restaurantId);
  }

  async createItem(restaurantId: string, input: CreateMenuItemInput): Promise<MenuItemAdminDTO> {
    await this.requireCategory(restaurantId, input.categoryId);
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { currency: true },
    });
    const sortOrder = input.sortOrder ?? (await this.nextItemOrder(input.categoryId));
    const created = toItem(
      await this.prisma.menuItem.create({
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
          allergens: input.allergens ?? [],
          dietaryTags: input.dietaryTags ?? [],
          stockQuantity: input.stockQuantity ?? null,
        },
        select: adminItemSelect,
      }),
    );
    await this.itemChanged(restaurantId, 'CREATED', created.id, created);
    return created;
  }

  async updateItem(restaurantId: string, itemId: string, input: UpdateMenuItemInput): Promise<MenuItemAdminDTO> {
    await this.requireItem(restaurantId, itemId);
    if (input.categoryId) await this.requireCategory(restaurantId, input.categoryId);
    const updated = toItem(
      await this.prisma.menuItem.update({ where: { id: itemId }, data: input, select: adminItemSelect }),
    );
    await this.itemChanged(restaurantId, 'UPDATED', itemId, updated);
    return updated;
  }

  /** An item that appears in any order stays (mark it sold out instead); order lines keep their snapshot either way. */
  async deleteItem(restaurantId: string, itemId: string): Promise<void> {
    await this.requireItem(restaurantId, itemId);
    const used = await this.prisma.orderItem.count({ where: { menuItemId: itemId } });
    if (used > 0) throw conflict('MENU_ITEM_IN_USE', 'Item is referenced by orders');
    await this.prisma.menuItem.delete({ where: { id: itemId } });
    await this.itemChanged(restaurantId, 'DELETED', itemId, null);
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
    await this.menuChanged(restaurantId, 'ITEMS_REORDERED', categoryId);
    return toCategory(
      await this.prisma.menuCategory.findUniqueOrThrow({ where: { id: categoryId }, select: adminCategorySelect }),
    );
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
    const updated = toItem(
      await this.prisma.menuItem.findUniqueOrThrow({ where: { id: itemId }, select: adminItemSelect }),
    );
    await this.itemChanged(restaurantId, 'UPDATED', itemId, updated);
    return updated;
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

  /**
   * Menu import (docs/PANEL.md). Categories and items are matched by name
   * (case and spacing ignored); missing categories are appended, missing
   * items created at the end of their category, existing ones updated only
   * in the columns the file has. One transaction: a file is applied whole
   * or not at all, and never when any line is invalid.
   */
  async importCsv(restaurantId: string, input: ImportMenuInput): Promise<MenuImportResultDTO> {
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { currency: true, countryCode: true },
    });
    const parsed = parseMenuCsv(input.csv, restaurant.currency, restaurant.countryCode);
    const categories = await this.prisma.menuCategory.findMany({
      where: { restaurantId },
      select: { id: true, name: true, sortOrder: true },
    });
    const items = await this.prisma.menuItem.findMany({
      where: { restaurantId },
      select: {
        id: true,
        categoryId: true,
        name: true,
        description: true,
        priceMinor: true,
        vatRateBps: true,
        isAvailable: true,
      },
    });
    const categoryByKey = new Map(categories.map((c) => [menuMatchKey(c.name), c]));
    const itemByKey = new Map(items.map((i) => [`${i.categoryId}\u0000${menuMatchKey(i.name)}`, i]));

    const categoriesCreated: string[] = [];
    const plannedCategories = new Set<string>();
    let itemsCreated = 0;
    let itemsUpdated = 0;
    let itemsUnchanged = 0;
    for (const row of parsed.rows) {
      const categoryKey = menuMatchKey(row.category);
      const category = categoryByKey.get(categoryKey);
      if (!category && !plannedCategories.has(categoryKey)) {
        plannedCategories.add(categoryKey);
        categoriesCreated.push(row.category);
      }
      const existing = category ? itemByKey.get(`${category.id}\u0000${menuMatchKey(row.name)}`) : undefined;
      if (!existing) itemsCreated += 1;
      else if (this.importChanges(existing, row)) itemsUpdated += 1;
      else itemsUnchanged += 1;
    }
    const summary = {
      rows: parsed.rows.length + new Set(parsed.issues.filter((i) => i.line > 1).map((i) => i.line)).size,
      categoriesCreated,
      itemsCreated,
      itemsUpdated,
      itemsUnchanged,
      issues: parsed.issues,
    };
    if (input.dryRun) return { dryRun: true, applied: false, ...summary };
    if (parsed.issues.length > 0) throw badRequest('MENU_IMPORT_INVALID', 'The file has invalid lines');

    await this.prisma.$transaction(async (tx) => {
      let nextCategoryOrder = categories.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1;
      const nextItemOrder = new Map<string, number>();
      const orderFor = async (categoryId: string): Promise<number> => {
        if (!nextItemOrder.has(categoryId)) {
          const last = await tx.menuItem.aggregate({ where: { categoryId }, _max: { sortOrder: true } });
          nextItemOrder.set(categoryId, (last._max.sortOrder ?? 0) + 1);
        }
        const value = nextItemOrder.get(categoryId)!;
        nextItemOrder.set(categoryId, value + 1);
        return value;
      };
      for (const row of parsed.rows) {
        const categoryKey = menuMatchKey(row.category);
        let category = categoryByKey.get(categoryKey);
        if (!category) {
          category = await tx.menuCategory.create({
            data: { restaurantId, name: row.category, sortOrder: nextCategoryOrder },
            select: { id: true, name: true, sortOrder: true },
          });
          nextCategoryOrder += 1;
          categoryByKey.set(categoryKey, category);
        }
        const existing = itemByKey.get(`${category.id}\u0000${menuMatchKey(row.name)}`);
        if (!existing) {
          await tx.menuItem.create({
            data: {
              restaurantId,
              categoryId: category.id,
              name: row.name,
              description: row.description ?? null,
              priceMinor: row.priceMinor,
              currency: restaurant.currency,
              vatRateBps: row.vatRateBps ?? parsed.defaultVatRateBps ?? 0,
              isAvailable: row.isAvailable ?? true,
              sortOrder: await orderFor(category.id),
            },
          });
        } else if (this.importChanges(existing, row)) {
          await tx.menuItem.update({
            where: { id: existing.id },
            data: {
              priceMinor: row.priceMinor,
              ...(row.description !== undefined ? { description: row.description } : {}),
              ...(row.vatRateBps !== undefined ? { vatRateBps: row.vatRateBps } : {}),
              ...(row.isAvailable !== undefined ? { isAvailable: row.isAvailable } : {}),
            },
          });
        }
      }
    });
    await this.menuChanged(restaurantId, 'IMPORTED', null);
    return { dryRun: false, applied: true, ...summary };
  }

  private importChanges(
    existing: { description: string | null; priceMinor: number; vatRateBps: number; isAvailable: boolean },
    row: {
      description: string | null | undefined;
      priceMinor: number;
      vatRateBps: number | undefined;
      isAvailable: boolean | undefined;
    },
  ): boolean {
    return (
      existing.priceMinor !== row.priceMinor ||
      (row.description !== undefined && existing.description !== row.description) ||
      (row.vatRateBps !== undefined && existing.vatRateBps !== row.vatRateBps) ||
      (row.isAvailable !== undefined && existing.isAvailable !== row.isAvailable)
    );
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

  /**
   * The ordered items whose category is outside its ordering window at the
   * instant (docs/OGUN_SAATLERI.md); empty while the module is off. Only
   * consumer orders are checked, like the opening hours.
   */
  async itemsNotServedAt(restaurantId: string, itemIds: string[], at: Date, timezone: string): Promise<string[]> {
    if (!(await this.features.isEnabled('menu_dayparts', restaurantId))) return [];
    const items = await this.prisma.menuItem.findMany({
      where: { restaurantId, id: { in: itemIds } },
      select: { name: true, category: { select: { availableHours: true } } },
    });
    return items
      .filter((item) => !categoryServedAt(hoursOf(item.category.availableHours), at, timezone))
      .map((item) => item.name);
  }
}
