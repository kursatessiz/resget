import { Injectable } from '@nestjs/common';
import type { Prisma } from '@resget/database';
import { AUDIT_PAGE_SIZE } from '@resget/shared';
import type { AuditEntryDTO, AuditPageDTO, AuditQuery } from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;
/** Longest meta text a row carries to the screen; the full entry stays in the database. */
const META_MAX = 2000;

/** The console's read-only view of the audit log (docs/ONAYLAR.md, module audit_viewer, global switch). */
@Injectable()
export class AuditViewerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
  ) {}

  async list(query: AuditQuery): Promise<AuditPageDTO> {
    await this.features.assertEnabled('audit_viewer', null);
    const where: Prisma.AuditLogWhereInput = {
      ...(query.restaurant ? { restaurant: { slug: query.restaurant } } : {}),
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lt: new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + DAY_MS) } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: {
          restaurant: { select: { id: true, name: true, slug: true } },
          actor: { select: { id: true, fullName: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * AUDIT_PAGE_SIZE,
        take: AUDIT_PAGE_SIZE,
      }),
    ]);
    const items: AuditEntryDTO[] = rows.map((row) => {
      const meta = row.meta === null ? null : JSON.stringify(row.meta);
      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        restaurant: row.restaurant,
        actor: row.actor,
        meta: meta && meta.length > META_MAX ? `${meta.slice(0, META_MAX)}...` : meta,
      };
    });
    return { items, total, page: query.page, pageSize: AUDIT_PAGE_SIZE };
  }
}
