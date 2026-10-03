import { Controller, Get, Patch } from '@nestjs/common';
import type { z } from 'zod';
import { CustomersQuerySchema, UpdateCustomerSchema, UuidSchema } from '@resget/shared';
import type { CustomerDTO, CustomerPageDTO, OrderSummaryDTO } from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import {
  RequirePermission,
  RequirePlanFeature,
  RestaurantScoped,
} from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { OrdersService } from '../orders/orders.service';
import { CustomersService } from './customers.service';

const contacts = (tenant: TenantContext): boolean => tenant.permissions.has('customers.contact.view');

/** The restaurant's customer list; notes and tags are the PRO `crm` feature. */
@Controller('restaurants/:restaurantId/customers')
@RestaurantScoped()
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly orders: OrdersService,
  ) {}

  @Get()
  @RequirePermission('customers.view')
  list(
    @Tenant() tenant: TenantContext,
    @ZodQuery(CustomersQuerySchema) query: z.infer<typeof CustomersQuerySchema>,
  ): Promise<CustomerPageDTO> {
    return this.customers.list(tenant.restaurantId, query, contacts(tenant));
  }

  @Get(':customerId')
  @RequirePermission('customers.view')
  get(@Tenant() tenant: TenantContext, @ZodParam('customerId', UuidSchema) customerId: string): Promise<CustomerDTO> {
    return this.customers.get(tenant.restaurantId, customerId, contacts(tenant));
  }

  /** The customer's recent orders, through the same mapper and masking as the orders screen. */
  @Get(':customerId/orders')
  @RequirePermission('customers.view', 'orders.view')
  async recentOrders(
    @Tenant() tenant: TenantContext,
    @ZodParam('customerId', UuidSchema) customerId: string,
  ): Promise<OrderSummaryDTO[]> {
    const customer = await this.customers.get(tenant.restaurantId, customerId, false);
    return this.orders.list(tenant.restaurantId, { customerUserId: customer.userId, limit: 20 }, contacts(tenant));
  }

  @Patch(':customerId')
  @RequirePermission('customers.manage')
  @RequirePlanFeature('crm')
  update(
    @Tenant() tenant: TenantContext,
    @ZodParam('customerId', UuidSchema) customerId: string,
    @ZodBody(UpdateCustomerSchema) body: z.infer<typeof UpdateCustomerSchema>,
  ): Promise<CustomerDTO> {
    return this.customers.update(tenant.restaurantId, customerId, body, contacts(tenant));
  }
}
