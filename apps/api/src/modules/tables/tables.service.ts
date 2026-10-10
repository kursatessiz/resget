import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import {
  BASE_LOCALE,
  BUNDLED_MESSAGES,
  TABLE_QR_TOKEN_BYTES,
  createTranslator,
  qrFunnelFromCounts,
  tableQrUrl,
} from '@resget/shared';
import type { QrFunnel, TableDTO, UpdateTableInput } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../../common/api-error';
import { fileSafe, renderQrLabelSvg, renderQrPng } from './qr-label';

export type { TableDTO } from '@resget/shared';

const tableSelect = { id: true, branchId: true, label: true, isActive: true, qrToken: true } as const;

@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private url(token: string): string {
    return tableQrUrl(this.config.getOrThrow<string>('PUBLIC_APP_URL'), token);
  }

  private toDto({ qrToken, ...table }: { qrToken: string } & Omit<TableDTO, 'qrUrl'>): TableDTO {
    return { ...table, qrUrl: this.url(qrToken) };
  }

  async list(restaurantId: string): Promise<TableDTO[]> {
    const tables = await this.prisma.diningTable.findMany({
      where: { restaurantId },
      orderBy: [{ branchId: 'asc' }, { label: 'asc' }],
      select: tableSelect,
    });
    return tables.map((t) => this.toDto(t));
  }

  async create(restaurantId: string, branchId: string, label: string): Promise<TableDTO> {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, restaurantId }, select: { id: true } });
    if (!branch) throw notFound('NOT_FOUND', 'Branch not found');
    const table = await this.prisma.diningTable.create({
      data: { restaurantId, branchId, label, qrToken: randomBytes(TABLE_QR_TOKEN_BYTES).toString('base64url') },
      select: tableSelect,
    });
    return this.toDto(table);
  }

  /** Rename or switch a table off; an inactive table's QR no longer opens the menu. */
  async update(restaurantId: string, tableId: string, input: UpdateTableInput): Promise<TableDTO> {
    await this.requireTable(restaurantId, tableId);
    const table = await this.prisma.diningTable.update({ where: { id: tableId }, data: input, select: tableSelect });
    return this.toDto(table);
  }

  /** Invalidates every printed sticker of the table; the panel warns before calling this. */
  async regenerate(restaurantId: string, tableId: string): Promise<TableDTO> {
    await this.requireTable(restaurantId, tableId);
    const table = await this.prisma.diningTable.update({
      where: { id: tableId },
      data: { qrToken: randomBytes(TABLE_QR_TOKEN_BYTES).toString('base64url') },
      select: tableSelect,
    });
    return this.toDto(table);
  }

  async labelSvg(restaurantId: string, tableId: string): Promise<{ svg: string; filename: string }> {
    const table = await this.requireTable(restaurantId, tableId);
    const { restaurant } = table;
    const messages = BUNDLED_MESSAGES[restaurant.defaultLocale] ?? BUNDLED_MESSAGES[BASE_LOCALE];
    const t = createTranslator({ locale: restaurant.defaultLocale, messages, fallback: BUNDLED_MESSAGES[BASE_LOCALE] });
    const svg = await renderQrLabelSvg({
      url: this.url(table.qrToken),
      title: restaurant.name,
      tableLine: t('tables.labelTable', { label: table.label }),
      caption: t('tables.labelCaption'),
      accent: restaurant.themePrimary,
    });
    return { svg, filename: `qr-${fileSafe(restaurant.slug)}-${fileSafe(table.label)}` };
  }

  async qrPng(restaurantId: string, tableId: string): Promise<{ png: Buffer; filename: string }> {
    const table = await this.requireTable(restaurantId, tableId);
    const png = await renderQrPng(this.url(table.qrToken));
    return { png, filename: `qr-${fileSafe(table.restaurant.slug)}-${fileSafe(table.label)}` };
  }

  async funnel(restaurantId: string, from: Date, to: Date): Promise<QrFunnel> {
    // Distinct sessions per step are counted in the database: the read does not grow with the number of events.
    const [counts] = await this.prisma.$queryRaw<
      { sessions: number; started: number; placed: number; registered: number }[]
    >`
      SELECT COUNT(DISTINCT q."sessionId")::int AS sessions,
             (COUNT(DISTINCT q."sessionId") FILTER (WHERE q.outcome IN ('STARTED_ORDER', 'PLACED_ORDER')))::int AS started,
             (COUNT(DISTINCT q."sessionId") FILTER (WHERE q.outcome = 'PLACED_ORDER'))::int AS placed,
             (COUNT(DISTINCT q."sessionId") FILTER (WHERE q.outcome = 'REGISTERED'))::int AS registered
      FROM qr_scan_events q
      WHERE q."restaurantId" = ${restaurantId} AND q."createdAt" >= ${from} AND q."createdAt" < ${to}`;
    return qrFunnelFromCounts({
      sessions: counts.sessions,
      startedOrder: counts.started,
      placedOrder: counts.placed,
      registered: counts.registered,
    });
  }

  private async requireTable(restaurantId: string, tableId: string) {
    const table = await this.prisma.diningTable.findFirst({
      where: { id: tableId, restaurantId },
      select: {
        ...tableSelect,
        restaurant: { select: { slug: true, name: true, themePrimary: true, defaultLocale: true } },
      },
    });
    if (!table) throw notFound('TABLE_NOT_FOUND', 'Table not found');
    return table;
  }
}
