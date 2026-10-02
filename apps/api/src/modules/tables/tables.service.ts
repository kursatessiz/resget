import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { TABLE_QR_TOKEN_BYTES, computeQrFunnel, tableQrUrl } from '@resget/shared';
import type { QrFunnel } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../../common/api-error';

export interface TableDTO {
  id: string;
  branchId: string;
  label: string;
  isActive: boolean;
  qrUrl: string;
}

@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private url(token: string): string {
    return tableQrUrl(this.config.getOrThrow<string>('PUBLIC_APP_URL'), token);
  }

  async list(restaurantId: string): Promise<TableDTO[]> {
    const tables = await this.prisma.diningTable.findMany({
      where: { restaurantId },
      orderBy: [{ branchId: 'asc' }, { label: 'asc' }],
      select: { id: true, branchId: true, label: true, isActive: true, qrToken: true },
    });
    return tables.map(({ qrToken, ...t }) => ({ ...t, qrUrl: this.url(qrToken) }));
  }

  async create(restaurantId: string, branchId: string, label: string): Promise<TableDTO> {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, restaurantId }, select: { id: true } });
    if (!branch) throw notFound('NOT_FOUND', 'Branch not found');
    const table = await this.prisma.diningTable.create({
      data: { restaurantId, branchId, label, qrToken: randomBytes(TABLE_QR_TOKEN_BYTES).toString('base64url') },
      select: { id: true, branchId: true, label: true, isActive: true, qrToken: true },
    });
    const { qrToken, ...rest } = table;
    return { ...rest, qrUrl: this.url(qrToken) };
  }

  /** Invalidates every printed sticker of the table; the panel warns before calling this. */
  async regenerate(restaurantId: string, tableId: string): Promise<TableDTO> {
    const existing = await this.prisma.diningTable.findFirst({
      where: { id: tableId, restaurantId },
      select: { id: true },
    });
    if (!existing) throw notFound('TABLE_NOT_FOUND', 'Table not found');
    const table = await this.prisma.diningTable.update({
      where: { id: tableId },
      data: { qrToken: randomBytes(TABLE_QR_TOKEN_BYTES).toString('base64url') },
      select: { id: true, branchId: true, label: true, isActive: true, qrToken: true },
    });
    const { qrToken, ...rest } = table;
    return { ...rest, qrUrl: this.url(qrToken) };
  }

  async funnel(restaurantId: string, from: Date, to: Date): Promise<QrFunnel> {
    const events = await this.prisma.qrScanEvent.findMany({
      where: { restaurantId, createdAt: { gte: from, lt: to } },
      select: { sessionId: true, outcome: true },
    });
    return computeQrFunnel(events);
  }
}
