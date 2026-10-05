import { Injectable } from '@nestjs/common';
import { Prisma } from '@resget/database';
import {
  AVAILABILITY_MAX_MINUTES,
  OpeningHoursSchema,
  isScheduledSlot,
  orderAvailability,
  scheduledSlots,
  schedulingSettingsFrom,
} from '@resget/shared';
import type {
  BranchHoursDTO,
  OrderAvailabilityDTO,
  SchedulingSettings,
  StorefrontSchedulingDTO,
  UpdateSchedulingSettingsInput,
  UpdateAvailabilityInput,
  UpdateOpeningHoursInput,
} from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { badRequest, conflict, notFound } from '../../common/api-error';

/** The restaurant fields availability reads; storefront selects carry them too. */
export const availabilitySelect = {
  id: true,
  timezone: true,
  ordersPausedUntil: true,
  busyExtraMinutes: true,
  busyUntil: true,
} as const;

export interface AvailabilityRow {
  id: string;
  timezone: string;
  ordersPausedUntil: Date | null;
  busyExtraMinutes: number;
  busyUntil: Date | null;
}

/**
 * Order availability (docs/SIPARIS_VE_SEVK.md, "Sipariş alma durumu"):
 * pause, busy mode and the opening hours of the ordering branch, behind the
 * order_availability module switch. Only consumer orders are refused; staff
 * entering a phone or counter order are not.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
  ) {}

  /** What applies now for a restaurant and branch (the first active branch when none is named). */
  async of(row: AvailabilityRow, branchId: string | null, now = new Date()): Promise<OrderAvailabilityDTO> {
    const enabled = await this.features.isEnabled('order_availability', row.id);
    const branch = enabled
      ? await this.prisma.branch.findFirst({
          where: branchId ? { id: branchId, restaurantId: row.id } : { restaurantId: row.id, isActive: true },
          orderBy: { createdAt: 'asc' },
          select: { openingHours: true },
        })
      : null;
    return orderAvailability({
      enabled,
      hours: branch?.openingHours ?? null,
      timezone: row.timezone,
      pausedUntil: row.ordersPausedUntil,
      busyExtraMinutes: row.busyExtraMinutes,
      busyUntil: row.busyUntil,
      now,
    });
  }

  /** Refuses a consumer order while paused or outside the hours. */
  async assertAccepting(row: AvailabilityRow, branchId: string | null): Promise<OrderAvailabilityDTO> {
    const availability = await this.of(row, branchId);
    if (!availability.accepting) {
      throw conflict('RESTAURANT_NOT_ACCEPTING', `Restaurant is not taking orders (${availability.state})`);
    }
    return availability;
  }

  // -- Scheduled orders (docs/ILERI_TARIHLI_SIPARIS.md) ---------------------------------

  /** The slots on offer for the ordering page; null while the module is off or the restaurant offers none. */
  async scheduling(
    row: Pick<AvailabilityRow, 'id' | 'timezone'>,
    branchId: string | null,
    now = new Date(),
  ): Promise<StorefrontSchedulingDTO | null> {
    const input = await this.slotInput(row, branchId, now);
    if (!input) return null;
    return {
      enabled: true,
      slotMinutes: input.settings.slotMinutes,
      slots: scheduledSlots(input).map((slot) => slot.toISOString()),
      timezone: row.timezone,
    };
  }

  /**
   * A consumer order for a later slot: the slot must be one on offer now.
   * Being outside the hours right now does not matter (that is what a
   * pre-order is for); a pause that lasts past the slot does.
   */
  async assertScheduledSlot(
    row: AvailabilityRow,
    branchId: string | null,
    scheduledFor: Date,
    now = new Date(),
  ): Promise<void> {
    const input = await this.slotInput(row, branchId, now);
    if (!input) throw conflict('SCHEDULING_UNAVAILABLE', 'No scheduled orders here');
    if (!isScheduledSlot(scheduledFor, input)) throw badRequest('SCHEDULED_SLOT_INVALID', 'Not an offered slot');
    const availability = await this.of(row, branchId, now);
    if (
      availability.state === 'PAUSED' &&
      (availability.pausedUntil === null || new Date(availability.pausedUntil).getTime() > scheduledFor.getTime())
    ) {
      throw conflict('RESTAURANT_NOT_ACCEPTING', 'Restaurant is paused past the slot');
    }
  }

  async schedulingSettings(restaurantId: string): Promise<SchedulingSettings> {
    const row = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { schedulingSettings: true },
    });
    if (!row) throw notFound('RESTAURANT_NOT_FOUND', 'Restaurant not found');
    return schedulingSettingsFrom(row.schedulingSettings);
  }

  async updateSchedulingSettings(
    restaurantId: string,
    actorUserId: string,
    input: UpdateSchedulingSettingsInput,
  ): Promise<SchedulingSettings> {
    const settings = schedulingSettingsFrom(input);
    await this.prisma.restaurant.update({ where: { id: restaurantId }, data: { schedulingSettings: settings } });
    await this.prisma.auditLog.create({
      data: {
        restaurantId,
        actorUserId,
        action: 'scheduling.update',
        entity: 'restaurant',
        entityId: restaurantId,
        meta: settings,
      },
    });
    return settings;
  }

  private async slotInput(row: Pick<AvailabilityRow, 'id' | 'timezone'>, branchId: string | null, now: Date) {
    if (!(await this.features.isEnabled('scheduled_orders', row.id))) return null;
    const [restaurant, branch] = await Promise.all([
      this.prisma.restaurant.findUnique({ where: { id: row.id }, select: { schedulingSettings: true } }),
      this.prisma.branch.findFirst({
        where: branchId ? { id: branchId, restaurantId: row.id } : { restaurantId: row.id, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { openingHours: true },
      }),
    ]);
    const settings = schedulingSettingsFrom(restaurant?.schedulingSettings);
    if (!settings.enabled) return null;
    return { hours: branch?.openingHours ?? null, timezone: row.timezone, settings, now };
  }

  async forTenant(tenant: TenantContext): Promise<OrderAvailabilityDTO> {
    return this.of(await this.row(tenant.restaurantId), null);
  }

  async update(
    tenant: TenantContext,
    actorUserId: string,
    input: UpdateAvailabilityInput,
  ): Promise<OrderAvailabilityDTO> {
    const now = Date.now();
    const data: Prisma.RestaurantUpdateInput = {};
    if (input.pause !== undefined) {
      // "Until I resume" still ends after a day, so a forgotten pause never hides a restaurant for good.
      data.ordersPausedUntil =
        input.pause === null ? null : new Date(now + (input.pause.minutes ?? AVAILABILITY_MAX_MINUTES) * 60_000);
    }
    if (input.busy !== undefined) {
      data.busyExtraMinutes = input.busy === null ? 0 : input.busy.extraMinutes;
      data.busyUntil = input.busy === null ? null : new Date(now + input.busy.minutes * 60_000);
    }
    await this.prisma.$transaction([
      this.prisma.restaurant.update({ where: { id: tenant.restaurantId }, data }),
      this.prisma.auditLog.create({
        data: {
          actorUserId,
          restaurantId: tenant.restaurantId,
          action: 'restaurant.availability.update',
          entity: 'Restaurant',
          entityId: tenant.restaurantId,
          meta: input as Prisma.InputJsonValue,
        },
      }),
    ]);
    return this.forTenant(tenant);
  }

  async hours(tenant: TenantContext): Promise<BranchHoursDTO[]> {
    const branches = await this.prisma.branch.findMany({
      where: { restaurantId: tenant.restaurantId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, openingHours: true },
    });
    return branches.map((b) => {
      const parsed = OpeningHoursSchema.safeParse(b.openingHours);
      return { branchId: b.id, name: b.name, hours: b.openingHours !== null && parsed.success ? parsed.data : null };
    });
  }

  async setHours(tenant: TenantContext, input: UpdateOpeningHoursInput): Promise<BranchHoursDTO[]> {
    const updated = await this.prisma.branch.updateMany({
      where: { id: input.branchId, restaurantId: tenant.restaurantId },
      data: { openingHours: input.hours === null ? Prisma.DbNull : (input.hours as Prisma.InputJsonValue) },
    });
    if (updated.count === 0) throw notFound('NOT_FOUND', 'Branch not found');
    return this.hours(tenant);
  }

  private async row(restaurantId: string): Promise<AvailabilityRow> {
    return this.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: availabilitySelect });
  }
}
