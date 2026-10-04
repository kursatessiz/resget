import { Injectable } from '@nestjs/common';
import { Prisma } from '@resget/database';
import {
  CONTACT_EXPORT_COLUMNS,
  PLATFORM_DEFAULT_STAGES,
  RESTAURANT_DEFAULT_STAGES,
  csvField,
  maskPhoneForDisplay,
} from '@resget/shared';
import type {
  ContactActivityDTO,
  ContactCardDTO,
  ContactDetailDTO,
  ContactTaskDTO,
  CreateContactInput,
  CreateTaskInput,
  LogActivityInput,
  PipelineDTO,
  PipelineStageDTO,
  UpdateContactInput,
} from '@resget/shared';
import { AttributionService } from '../attribution/attribution.service';
import { ConsentService } from '../consent/consent.service';
import { PrismaService } from '../prisma/prisma.service';
import { badRequest, conflict, notFound } from '../../common/api-error';

const PER_STAGE_LIMIT = 100;

const contactSelect = Prisma.validator<Prisma.RestaurantCustomerSelect>()({
  id: true,
  email: true,
  company: true,
  city: true,
  district: true,
  source: true,
  stageId: true,
  orderCount: true,
  lastActivityAt: true,
  createdAt: true,
  user: { select: { fullName: true, phone: true } },
  owner: { select: { id: true, user: { select: { fullName: true } } } },
  _count: { select: { tasks: { where: { doneAt: null } } } },
});
type ContactRow = Prisma.RestaurantCustomerGetPayload<{ select: typeof contactSelect }>;

const taskSelect = Prisma.validator<Prisma.ContactTaskSelect>()({
  id: true,
  customerId: true,
  title: true,
  dueAt: true,
  doneAt: true,
  createdAt: true,
  customer: { select: { user: { select: { fullName: true } } } },
  assignee: { select: { id: true, user: { select: { fullName: true } } } },
});
type TaskRow = Prisma.ContactTaskGetPayload<{ select: typeof taskSelect }>;

/**
 * CRM core (docs/CRM.md). A contact is a RestaurantCustomer row, prospects
 * included (no order yet, firstChannel null). Stages are created from the
 * defaults of the tenant kind (platform funnel or restaurant leads) on
 * first use; every stage change and finished task lands in the activity
 * history, which is append-only.
 */
@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attribution: AttributionService,
    private readonly consent: ConsentService,
  ) {}

  // -- Stages --------------------------------------------------------------------------

  async stages(restaurantId: string): Promise<PipelineStageDTO[]> {
    await this.ensureStages(restaurantId);
    const rows = await this.prisma.pipelineStage.findMany({ where: { restaurantId }, orderBy: { position: 'asc' } });
    return rows.map((s) => ({ id: s.id, key: s.key, name: s.name, kind: s.kind, position: s.position }));
  }

  private async ensureStages(restaurantId: string): Promise<void> {
    const count = await this.prisma.pipelineStage.count({ where: { restaurantId } });
    if (count > 0) return;
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { isPlatform: true },
    });
    const defaults = restaurant.isPlatform ? PLATFORM_DEFAULT_STAGES : RESTAURANT_DEFAULT_STAGES;
    await this.prisma.pipelineStage.createMany({
      data: defaults.map((stage, position) => ({ restaurantId, key: stage.key, kind: stage.kind, position })),
      skipDuplicates: true,
    });
  }

  // -- Contacts ------------------------------------------------------------------------

  async pipeline(restaurantId: string, canSeeContacts: boolean): Promise<PipelineDTO> {
    const stages = await this.stages(restaurantId);
    const groups = await Promise.all(
      [...stages.map((s) => s.id), null].map((stageId) =>
        this.prisma.restaurantCustomer.findMany({
          where: {
            restaurantId,
            stageId,
            user: { deletedAt: null },
            ...(stageId === null ? { firstChannel: null } : {}),
          },
          orderBy: [{ lastActivityAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
          take: PER_STAGE_LIMIT,
          select: contactSelect,
        }),
      ),
    );
    const contacts: Record<string, ContactCardDTO[]> = {};
    stages.forEach((stage, index) => {
      contacts[stage.id] = groups[index].map((row) => this.toCard(row, canSeeContacts));
    });
    // Prospects added without a stage; ordering customers without one stay on the customer list.
    contacts.none = groups[stages.length].map((row) => this.toCard(row, canSeeContacts));
    return { stages, contacts, owners: await this.owners(restaurantId) };
  }

  async create(restaurantId: string, input: CreateContactInput, canSeeContacts: boolean): Promise<ContactCardDTO> {
    if (input.stageId) await this.requireStage(restaurantId, input.stageId);
    const user = await this.prisma.user.upsert({
      where: { phone: input.phone },
      update: {},
      create: { phone: input.phone, fullName: input.fullName },
      select: { id: true },
    });
    const existing = await this.prisma.restaurantCustomer.findUnique({
      where: { restaurantId_userId: { restaurantId, userId: user.id } },
      select: { id: true },
    });
    if (existing) throw conflict('CONTACT_EXISTS', 'This phone is already a contact');
    const row = await this.prisma.restaurantCustomer.create({
      data: {
        restaurantId,
        userId: user.id,
        email: input.email ?? null,
        company: input.company ?? null,
        city: input.city ?? null,
        district: input.district ?? null,
        source: input.source ?? null,
        stageId: input.stageId ?? null,
        tags: input.tags ?? [],
        lastActivityAt: new Date(),
      },
      select: contactSelect,
    });
    return this.toCard(row, canSeeContacts);
  }

  async update(
    restaurantId: string,
    customerId: string,
    actorUserId: string,
    input: UpdateContactInput,
    canSeeContacts: boolean,
  ): Promise<ContactCardDTO> {
    const before = await this.requireContact(restaurantId, customerId);
    if (input.stageId) await this.requireStage(restaurantId, input.stageId);
    if (input.ownerMembershipId) {
      const owner = await this.prisma.membership.findFirst({
        where: { id: input.ownerMembershipId, restaurantId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!owner) throw badRequest('VALIDATION', 'Owner must be an active member');
    }
    const stageChanged = input.stageId !== undefined && input.stageId !== before.stageId;
    const row = await this.prisma.$transaction(async (tx) => {
      if (stageChanged) {
        const stage = input.stageId
          ? await tx.pipelineStage.findUniqueOrThrow({
              where: { id: input.stageId },
              select: { key: true, name: true },
            })
          : null;
        await tx.contactActivity.create({
          data: {
            restaurantId,
            customerId,
            type: 'STAGE_CHANGE',
            body: stage ? (stage.name ?? stage.key) : null,
            actorUserId,
          },
        });
      }
      return tx.restaurantCustomer.update({
        where: { id: customerId },
        data: { ...input, ...(stageChanged ? { lastActivityAt: new Date() } : {}) },
        select: contactSelect,
      });
    });
    return this.toCard(row, canSeeContacts);
  }

  async detail(restaurantId: string, customerId: string, canSeeContacts: boolean): Promise<ContactDetailDTO> {
    await this.requireContact(restaurantId, customerId);
    const [row, activities, tasks, attribution, consentOn] = await Promise.all([
      this.prisma.restaurantCustomer.findUniqueOrThrow({ where: { id: customerId }, select: contactSelect }),
      this.prisma.contactActivity.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, type: true, body: true, createdAt: true, actor: { select: { fullName: true } } },
      }),
      this.prisma.contactTask.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, select: taskSelect }),
      this.attribution.contactAttribution(restaurantId, customerId),
      this.consent.enabled(restaurantId),
    ]);
    return {
      contact: this.toCard(row, canSeeContacts),
      activities: activities.map((a): ContactActivityDTO => ({
        id: a.id,
        type: a.type,
        body: a.body,
        actorName: a.actor?.fullName ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
      tasks: tasks.map((t) => this.toTask(t)),
      attribution,
      consent: consentOn ? await this.consent.contactConsent(restaurantId, customerId) : null,
    };
  }

  async logActivity(restaurantId: string, customerId: string, actorUserId: string, input: LogActivityInput) {
    await this.requireContact(restaurantId, customerId);
    await this.prisma.$transaction([
      this.prisma.contactActivity.create({
        data: { restaurantId, customerId, type: input.type, body: input.body, actorUserId },
      }),
      this.prisma.restaurantCustomer.update({ where: { id: customerId }, data: { lastActivityAt: new Date() } }),
    ]);
  }

  // -- Tasks ---------------------------------------------------------------------------

  async createTask(
    restaurantId: string,
    customerId: string,
    actorUserId: string,
    input: CreateTaskInput,
  ): Promise<ContactTaskDTO> {
    await this.requireContact(restaurantId, customerId);
    if (input.assigneeMembershipId) {
      const assignee = await this.prisma.membership.findFirst({
        where: { id: input.assigneeMembershipId, restaurantId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!assignee) throw badRequest('VALIDATION', 'Assignee must be an active member');
    }
    const task = await this.prisma.contactTask.create({
      data: {
        restaurantId,
        customerId,
        title: input.title,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        assigneeMembershipId: input.assigneeMembershipId ?? null,
        createdByUserId: actorUserId,
      },
      select: taskSelect,
    });
    return this.toTask(task);
  }

  async setTaskDone(restaurantId: string, taskId: string, actorUserId: string, done: boolean): Promise<ContactTaskDTO> {
    const task = await this.prisma.contactTask.findFirst({ where: { id: taskId, restaurantId }, select: taskSelect });
    if (!task) throw notFound('NOT_FOUND', 'Task not found');
    const updated = await this.prisma.$transaction(async (tx) => {
      if (done && !task.doneAt) {
        await tx.contactActivity.create({
          data: { restaurantId, customerId: task.customerId, type: 'TASK_DONE', body: task.title, actorUserId },
        });
        await tx.restaurantCustomer.update({ where: { id: task.customerId }, data: { lastActivityAt: new Date() } });
      }
      return tx.contactTask.update({
        where: { id: taskId },
        data: { doneAt: done ? new Date() : null },
        select: taskSelect,
      });
    });
    return this.toTask(updated);
  }

  /** Open tasks of the tenant, due first; mine limits them to the caller's membership. */
  async openTasks(restaurantId: string, membershipId: string | null, mine: boolean): Promise<ContactTaskDTO[]> {
    const rows = await this.prisma.contactTask.findMany({
      where: { restaurantId, doneAt: null, ...(mine ? { assigneeMembershipId: membershipId ?? '-' } : {}) },
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      take: 200,
      select: taskSelect,
    });
    return rows.map((t) => this.toTask(t));
  }

  // -- Export --------------------------------------------------------------------------

  /** Every contact as CSV (header row of column keys); needs customers.contact.view, so phones are never masked here. */
  async exportCsv(restaurantId: string): Promise<string> {
    const [rows, stages] = await Promise.all([
      this.prisma.restaurantCustomer.findMany({
        where: { restaurantId, user: { deletedAt: null } },
        orderBy: { createdAt: 'asc' },
        take: 50_000,
        select: {
          email: true,
          company: true,
          city: true,
          district: true,
          source: true,
          stageId: true,
          orderCount: true,
          marketingOptIn: true,
          createdAt: true,
          user: { select: { fullName: true, phone: true } },
        },
      }),
      this.prisma.pipelineStage.findMany({ where: { restaurantId }, select: { id: true, key: true, name: true } }),
    ]);
    const stageName = new Map(stages.map((s) => [s.id, s.name ?? s.key ?? '']));
    const lines = [CONTACT_EXPORT_COLUMNS.join(',')];
    for (const row of rows) {
      lines.push(
        [
          row.user.fullName,
          row.user.phone,
          row.email,
          row.company,
          row.city,
          row.district,
          row.source,
          row.stageId ? (stageName.get(row.stageId) ?? '') : null,
          row.orderCount,
          row.marketingOptIn,
          row.createdAt.toISOString(),
        ]
          .map(csvField)
          .join(','),
      );
    }
    return `${lines.join('\r\n')}\r\n`;
  }

  // -- Helpers -------------------------------------------------------------------------

  private async owners(restaurantId: string) {
    const rows = await this.prisma.membership.findMany({
      where: { restaurantId, status: 'ACTIVE', user: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, user: { select: { fullName: true } } },
    });
    return rows.map((m) => ({ membershipId: m.id, fullName: m.user.fullName }));
  }

  private async requireContact(restaurantId: string, customerId: string) {
    const row = await this.prisma.restaurantCustomer.findFirst({
      where: { id: customerId, restaurantId, user: { deletedAt: null } },
      select: { id: true, stageId: true },
    });
    if (!row) throw notFound('NOT_FOUND', 'Contact not found');
    return row;
  }

  private async requireStage(restaurantId: string, stageId: string) {
    const stage = await this.prisma.pipelineStage.findFirst({
      where: { id: stageId, restaurantId },
      select: { id: true },
    });
    if (!stage) throw badRequest('VALIDATION', 'Unknown stage');
  }

  private toCard(row: ContactRow, canSeeContacts: boolean): ContactCardDTO {
    return {
      id: row.id,
      fullName: row.user.fullName,
      phone: canSeeContacts ? row.user.phone : maskPhoneForDisplay(row.user.phone),
      email: canSeeContacts ? row.email : null,
      company: row.company,
      city: row.city,
      district: row.district,
      source: row.source,
      stageId: row.stageId,
      owner: row.owner ? { membershipId: row.owner.id, fullName: row.owner.user.fullName } : null,
      orderCount: row.orderCount,
      openTasks: row._count.tasks,
      lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toTask(row: TaskRow): ContactTaskDTO {
    return {
      id: row.id,
      customerId: row.customerId,
      contactName: row.customer.user.fullName,
      title: row.title,
      dueAt: row.dueAt?.toISOString() ?? null,
      doneAt: row.doneAt?.toISOString() ?? null,
      assignee: row.assignee ? { membershipId: row.assignee.id, fullName: row.assignee.user.fullName } : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
