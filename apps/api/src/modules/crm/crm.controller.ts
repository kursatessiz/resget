import { Controller, Get, Header, HttpCode, Patch, Post, Query } from '@nestjs/common';
import {
  CreateContactSchema,
  CreateTaskSchema,
  LogActivitySchema,
  UpdateContactSchema,
  UpdateTaskSchema,
  UuidSchema,
} from '@resget/shared';
import type {
  ContactCardDTO,
  ContactDetailDTO,
  ContactTaskDTO,
  CreateContactInput,
  CreateTaskInput,
  LogActivityInput,
  PipelineDTO,
  UpdateContactInput,
  UpdateTaskInput,
} from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import {
  RequireFeature,
  RequirePermission,
  RequirePlanFeature,
  RestaurantScoped,
} from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { CrmService } from './crm.service';

const canSee = (tenant: TenantContext) => tenant.permissions.has('customers.contact.view');

/** Contacts, pipeline, activities and tasks of a tenant (docs/CRM.md); reading is open, writing is PRO crm. */
@Controller('restaurants/:restaurantId/crm')
@RestaurantScoped()
@RequireFeature('contacts_crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get('pipeline')
  @RequirePermission('customers.view')
  pipeline(@Tenant() tenant: TenantContext): Promise<PipelineDTO> {
    return this.crm.pipeline(tenant.restaurantId, canSee(tenant));
  }

  @Post('contacts')
  @RequirePermission('customers.manage')
  @RequirePlanFeature('crm')
  create(
    @Tenant() tenant: TenantContext,
    @ZodBody(CreateContactSchema) body: CreateContactInput,
  ): Promise<ContactCardDTO> {
    return this.crm.create(tenant.restaurantId, body, canSee(tenant));
  }

  @Get('contacts/:customerId')
  @RequirePermission('customers.view')
  detail(
    @Tenant() tenant: TenantContext,
    @ZodParam('customerId', UuidSchema) customerId: string,
  ): Promise<ContactDetailDTO> {
    return this.crm.detail(tenant.restaurantId, customerId, canSee(tenant));
  }

  @Patch('contacts/:customerId')
  @RequirePermission('customers.manage')
  @RequirePlanFeature('crm')
  update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('customerId', UuidSchema) customerId: string,
    @ZodBody(UpdateContactSchema) body: UpdateContactInput,
  ): Promise<ContactCardDTO> {
    return this.crm.update(tenant.restaurantId, customerId, user.id, body, canSee(tenant));
  }

  @Post('contacts/:customerId/activities')
  @HttpCode(204)
  @RequirePermission('customers.manage')
  @RequirePlanFeature('crm')
  async log(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('customerId', UuidSchema) customerId: string,
    @ZodBody(LogActivitySchema) body: LogActivityInput,
  ): Promise<void> {
    await this.crm.logActivity(tenant.restaurantId, customerId, user.id, body);
  }

  @Post('contacts/:customerId/tasks')
  @RequirePermission('customers.manage')
  @RequirePlanFeature('crm')
  createTask(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('customerId', UuidSchema) customerId: string,
    @ZodBody(CreateTaskSchema) body: CreateTaskInput,
  ): Promise<ContactTaskDTO> {
    return this.crm.createTask(tenant.restaurantId, customerId, user.id, body);
  }

  @Get('tasks')
  @RequirePermission('customers.view')
  tasks(@Tenant() tenant: TenantContext, @Query('mine') mine?: string): Promise<ContactTaskDTO[]> {
    return this.crm.openTasks(tenant.restaurantId, tenant.membershipId, mine === 'true');
  }

  @Patch('tasks/:taskId')
  @RequirePermission('customers.manage')
  @RequirePlanFeature('crm')
  setTask(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('taskId', UuidSchema) taskId: string,
    @ZodBody(UpdateTaskSchema) body: UpdateTaskInput,
  ): Promise<ContactTaskDTO> {
    return this.crm.setTaskDone(tenant.restaurantId, taskId, user.id, body.done);
  }

  /** Every contact with phone numbers: only for those who may see them. */
  @Get('export.csv')
  @RequirePermission('customers.contact.view')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="contacts.csv"')
  export(@Tenant() tenant: TenantContext): Promise<string> {
    return this.crm.exportCsv(tenant.restaurantId);
  }
}
