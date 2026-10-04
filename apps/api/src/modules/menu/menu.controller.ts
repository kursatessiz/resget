import { Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import {
  CreateMenuCategorySchema,
  ImportMenuSchema,
  CreateMenuItemSchema,
  ReorderSchema,
  ReplaceModifierGroupsSchema,
  UpdateMenuCategorySchema,
  UpdateMenuItemSchema,
  UuidSchema,
} from '@resget/shared';
import type { MenuAdminDTO, MenuCategoryAdminDTO, MenuImportResultDTO, MenuItemAdminDTO } from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { MenuService } from './menu.service';

@Controller('restaurants/:restaurantId/menu')
@RestaurantScoped()
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  /** The guest-facing menu as staff screens use it (order taking). */
  @Get()
  @RequirePermission('menu.view')
  list(@Tenant() tenant: TenantContext) {
    return this.menu.menuOf(tenant.restaurantId);
  }

  /** Everything the menu editor needs, hidden and sold-out rows included. */
  @Get('manage')
  @RequirePermission('menu.manage')
  manage(@Tenant() tenant: TenantContext): Promise<MenuAdminDTO> {
    return this.menu.adminMenu(tenant.restaurantId);
  }

  /** Spreadsheet import: a dry run reports every bad line; a real run applies only a fully valid file (docs/PANEL.md). */
  @Post('import')
  @HttpCode(200)
  @RequirePermission('menu.manage')
  importMenu(
    @Tenant() tenant: TenantContext,
    @ZodBody(ImportMenuSchema) body: z.infer<typeof ImportMenuSchema>,
  ): Promise<MenuImportResultDTO> {
    return this.menu.importCsv(tenant.restaurantId, body);
  }

  @Post('categories')
  @RequirePermission('menu.manage')
  createCategory(
    @Tenant() tenant: TenantContext,
    @ZodBody(CreateMenuCategorySchema) body: z.infer<typeof CreateMenuCategorySchema>,
  ): Promise<MenuCategoryAdminDTO> {
    return this.menu.createCategory(tenant.restaurantId, body);
  }

  @Post('categories/reorder')
  @HttpCode(200)
  @RequirePermission('menu.manage')
  reorderCategories(
    @Tenant() tenant: TenantContext,
    @ZodBody(ReorderSchema) body: z.infer<typeof ReorderSchema>,
  ): Promise<MenuAdminDTO> {
    return this.menu.reorderCategories(tenant.restaurantId, body.ids);
  }

  @Patch('categories/:categoryId')
  @RequirePermission('menu.manage')
  updateCategory(
    @Tenant() tenant: TenantContext,
    @ZodParam('categoryId', UuidSchema) categoryId: string,
    @ZodBody(UpdateMenuCategorySchema) body: z.infer<typeof UpdateMenuCategorySchema>,
  ): Promise<MenuCategoryAdminDTO> {
    return this.menu.updateCategory(tenant.restaurantId, categoryId, body);
  }

  @Delete('categories/:categoryId')
  @HttpCode(204)
  @RequirePermission('menu.manage')
  deleteCategory(
    @Tenant() tenant: TenantContext,
    @ZodParam('categoryId', UuidSchema) categoryId: string,
  ): Promise<void> {
    return this.menu.deleteCategory(tenant.restaurantId, categoryId);
  }

  @Post('categories/:categoryId/items/reorder')
  @HttpCode(200)
  @RequirePermission('menu.manage')
  reorderItems(
    @Tenant() tenant: TenantContext,
    @ZodParam('categoryId', UuidSchema) categoryId: string,
    @ZodBody(ReorderSchema) body: z.infer<typeof ReorderSchema>,
  ): Promise<MenuCategoryAdminDTO> {
    return this.menu.reorderItems(tenant.restaurantId, categoryId, body.ids);
  }

  @Post('items')
  @RequirePermission('menu.manage')
  createItem(
    @Tenant() tenant: TenantContext,
    @ZodBody(CreateMenuItemSchema) body: z.infer<typeof CreateMenuItemSchema>,
  ): Promise<MenuItemAdminDTO> {
    return this.menu.createItem(tenant.restaurantId, body);
  }

  @Patch('items/:itemId')
  @RequirePermission('menu.manage')
  updateItem(
    @Tenant() tenant: TenantContext,
    @ZodParam('itemId', UuidSchema) itemId: string,
    @ZodBody(UpdateMenuItemSchema) body: z.infer<typeof UpdateMenuItemSchema>,
  ): Promise<MenuItemAdminDTO> {
    return this.menu.updateItem(tenant.restaurantId, itemId, body);
  }

  @Delete('items/:itemId')
  @HttpCode(204)
  @RequirePermission('menu.manage')
  deleteItem(@Tenant() tenant: TenantContext, @ZodParam('itemId', UuidSchema) itemId: string): Promise<void> {
    return this.menu.deleteItem(tenant.restaurantId, itemId);
  }

  @Put('items/:itemId/modifier-groups')
  @RequirePermission('menu.manage')
  replaceModifierGroups(
    @Tenant() tenant: TenantContext,
    @ZodParam('itemId', UuidSchema) itemId: string,
    @ZodBody(ReplaceModifierGroupsSchema) body: z.infer<typeof ReplaceModifierGroupsSchema>,
  ): Promise<MenuItemAdminDTO> {
    return this.menu.replaceModifierGroups(tenant.restaurantId, itemId, body);
  }
}
