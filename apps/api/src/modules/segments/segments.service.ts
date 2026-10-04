import { Injectable } from '@nestjs/common';
import type { Prisma } from '@resget/database';
import { CONSENT_CHANNELS, SegmentRuleSchema, segmentUsesField, visibleContact } from '@resget/shared';
import type {
  CreateSegmentInput,
  SegmentDTO,
  SegmentGroup,
  SegmentKind,
  SegmentListDTO,
  SegmentPreviewDTO,
  UpdateSegmentInput,
} from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { conflict, notFound } from '../../common/api-error';
import { segmentWhere } from './segment-compiler';

type SegmentRow = Prisma.SegmentGetPayload<object>;
const SAMPLE_SIZE = 10;

/**
 * Saved audiences (docs/SEGMENTLER.md). A dynamic segment is its rule,
 * evaluated whenever it is counted or used; a static segment keeps the
 * members it had when the snapshot was taken, until the snapshot is retaken.
 */
@Injectable()
export class SegmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
  ) {}

  /** A new rule may read the churn class only while its module is on (docs/KAYIP_RISKI.md). */
  private async assertFields(restaurantId: string, rule: SegmentGroup): Promise<void> {
    if (segmentUsesField(rule, 'churnRisk')) await this.features.assertEnabled('churn_signals', restaurantId);
  }

  private ruleOf(row: SegmentRow): SegmentGroup {
    const parsed = SegmentRuleSchema.safeParse(row.rule);
    return parsed.success ? parsed.data : { op: 'AND', rules: [] };
  }

  /** Who a segment stands for right now: the rule for a dynamic one, the snapshot for a static one. */
  audienceWhere(row: SegmentRow, now: Date = new Date()): Prisma.RestaurantCustomerWhereInput {
    if (row.kind === 'STATIC') {
      return {
        restaurantId: row.restaurantId,
        user: { deletedAt: null },
        segmentMembers: { some: { segmentId: row.id } },
      };
    }
    return segmentWhere(row.restaurantId, this.ruleOf(row), now);
  }

  async require(restaurantId: string, segmentId: string): Promise<SegmentRow> {
    const row = await this.prisma.segment.findFirst({ where: { id: segmentId, restaurantId } });
    if (!row) throw notFound('SEGMENT_NOT_FOUND', 'Segment not found');
    return row;
  }

  private async toDto(row: SegmentRow): Promise<SegmentDTO> {
    const count =
      row.kind === 'STATIC'
        ? row.memberCount
        : await this.prisma.restaurantCustomer.count({ where: this.audienceWhere(row) });
    return {
      id: row.id,
      name: row.name,
      kind: row.kind as SegmentKind,
      rule: this.ruleOf(row),
      count,
      snapshotAt: row.snapshotAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(restaurantId: string): Promise<SegmentListDTO> {
    const [restaurant, rows] = await Promise.all([
      this.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { currency: true } }),
      this.prisma.segment.findMany({ where: { restaurantId }, orderBy: { name: 'asc' } }),
    ]);
    return { currency: restaurant.currency, items: await Promise.all(rows.map((row) => this.toDto(row))) };
  }

  async get(restaurantId: string, segmentId: string): Promise<SegmentDTO> {
    return this.toDto(await this.require(restaurantId, segmentId));
  }

  async create(restaurantId: string, userId: string, input: CreateSegmentInput): Promise<SegmentDTO> {
    await this.assertFields(restaurantId, input.rule);
    const exists = await this.prisma.segment.findUnique({
      where: { restaurantId_name: { restaurantId, name: input.name } },
      select: { id: true },
    });
    if (exists) throw conflict('SEGMENT_NAME_TAKEN', 'A segment with this name exists');
    const row = await this.prisma.segment.create({
      data: {
        restaurantId,
        name: input.name,
        kind: input.kind,
        rule: input.rule as unknown as Prisma.InputJsonValue,
        createdByUserId: userId,
      },
    });
    if (input.kind === 'STATIC') return this.toDto(await this.takeSnapshot(row));
    return this.toDto(row);
  }

  async update(restaurantId: string, segmentId: string, input: UpdateSegmentInput): Promise<SegmentDTO> {
    const row = await this.require(restaurantId, segmentId);
    if (input.rule) await this.assertFields(restaurantId, input.rule);
    if (input.name && input.name !== row.name) {
      const exists = await this.prisma.segment.findUnique({
        where: { restaurantId_name: { restaurantId, name: input.name } },
        select: { id: true },
      });
      if (exists) throw conflict('SEGMENT_NAME_TAKEN', 'A segment with this name exists');
    }
    const updated = await this.prisma.segment.update({
      where: { id: row.id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.rule ? { rule: input.rule as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    // A static segment's members follow its rule only when the snapshot is taken; a new rule takes a new one.
    if (input.rule && updated.kind === 'STATIC') return this.toDto(await this.takeSnapshot(updated));
    return this.toDto(updated);
  }

  async remove(restaurantId: string, segmentId: string): Promise<void> {
    const row = await this.require(restaurantId, segmentId);
    // A campaign still to send would lose its audience; it must be retargeted or cancelled first.
    const inUse = await this.prisma.campaign.count({
      where: { restaurantId, segmentId: row.id, status: { in: ['DRAFT', 'SCHEDULED', 'SENDING'] } },
    });
    // A flow would lose its filter and, worse, its SET NULL would widen it to everyone.
    const flows = await this.prisma.journey.count({ where: { restaurantId, segmentId: row.id } });
    if (inUse > 0 || flows > 0) throw conflict('SEGMENT_IN_USE', 'A campaign or flow targets this segment');
    await this.prisma.segment.delete({ where: { id: row.id } });
  }

  async snapshot(restaurantId: string, segmentId: string): Promise<SegmentDTO> {
    const row = await this.require(restaurantId, segmentId);
    if (row.kind !== 'STATIC') throw conflict('SEGMENT_NOT_STATIC', 'Only a static segment has a snapshot');
    return this.toDto(await this.takeSnapshot(row));
  }

  private async takeSnapshot(row: SegmentRow): Promise<SegmentRow> {
    const now = new Date();
    const members = await this.prisma.restaurantCustomer.findMany({
      where: segmentWhere(row.restaurantId, this.ruleOf(row), now),
      select: { id: true },
    });
    return this.prisma.$transaction(async (tx) => {
      await tx.segmentMember.deleteMany({ where: { segmentId: row.id } });
      if (members.length > 0) {
        await tx.segmentMember.createMany({
          data: members.map((m) => ({ segmentId: row.id, customerId: m.id })),
          skipDuplicates: true,
        });
      }
      return tx.segment.update({ where: { id: row.id }, data: { memberCount: members.length, snapshotAt: now } });
    });
  }

  /** How many match, how many each channel can reach now, and a few of them. */
  async preview(restaurantId: string, rule: SegmentGroup, canSeeContacts: boolean): Promise<SegmentPreviewDTO> {
    await this.assertFields(restaurantId, rule);
    const where = segmentWhere(restaurantId, rule, new Date());
    const [count, sample, ...perChannel] = await Promise.all([
      this.prisma.restaurantCustomer.count({ where }),
      this.prisma.restaurantCustomer.findMany({
        where,
        orderBy: [{ lastOrderAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: SAMPLE_SIZE,
        select: {
          id: true,
          orderCount: true,
          lastOrderAt: true,
          user: { select: { fullName: true, phone: true } },
        },
      }),
      ...CONSENT_CHANNELS.map((channel) =>
        this.prisma.restaurantCustomer.count({ where: { AND: [where, { consentChannels: { has: channel } }] } }),
      ),
    ]);
    return {
      count,
      reachable: Object.fromEntries(CONSENT_CHANNELS.map((channel, i) => [channel, perChannel[i]])),
      sample: sample.map((s) => ({
        id: s.id,
        fullName: canSeeContacts ? (visibleContact(s.user)?.fullName ?? null) : null,
        orderCount: s.orderCount,
        lastOrderAt: s.lastOrderAt?.toISOString() ?? null,
      })),
    };
  }
}
