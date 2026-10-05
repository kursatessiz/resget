import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Injectable, Logger, StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { badRequest, notFound } from '../../common/api-error';

/** What the multipart interceptor hands over; typed structurally so no multer typings are needed. */
export interface UploadedImage {
  buffer: Buffer;
  size: number;
  originalname: string;
}

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTENT_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

/** The image kind is read from the bytes, never from the client's file name or declared type. */
export function sniffImage(buffer: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * Local-disk uploads (docs/TASARIM.md, "Isletme logosu"): the only files
 * the platform stores itself. Files live under UPLOADS_DIR (a named volume
 * in production), are served by the API with immutable caching, and are
 * referenced by absolute URL from the restaurant row so the web app never
 * needs to know where the disk is.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  readonly root: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.root = path.resolve(this.config.get<string>('UPLOADS_DIR') ?? path.join(process.cwd(), 'uploads'));
  }

  /** Stores a new logo, points the restaurant at it and removes the previous one when it was ours. */
  async storeLogo(restaurantId: string, file: UploadedImage | undefined): Promise<string> {
    if (!file || file.size === 0) throw badRequest('UNSUPPORTED_FILE', 'No file received');
    if (file.size > LOGO_MAX_BYTES) throw badRequest('FILE_TOO_LARGE', 'Logo exceeds the size limit');
    const kind = sniffImage(file.buffer);
    if (!kind) throw badRequest('UNSUPPORTED_FILE', 'Only PNG, JPEG and WebP images are accepted');
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { logoUrl: true },
    });
    if (!restaurant) throw notFound('RESTAURANT_NOT_FOUND', 'Restaurant not found');
    const name = `${randomUUID()}.${kind}`;
    const dir = path.join(this.root, 'logos', restaurantId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), file.buffer, { flag: 'wx' });
    const logoUrl = `${this.publicApiUrl()}/uploads/logos/${restaurantId}/${name}`;
    await this.prisma.restaurant.update({ where: { id: restaurantId }, data: { logoUrl } });
    await this.removeOwnFile(restaurantId, restaurant.logoUrl);
    return logoUrl;
  }

  async removeLogo(restaurantId: string): Promise<void> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { logoUrl: true },
    });
    if (!restaurant) throw notFound('RESTAURANT_NOT_FOUND', 'Restaurant not found');
    await this.prisma.restaurant.update({ where: { id: restaurantId }, data: { logoUrl: null } });
    await this.removeOwnFile(restaurantId, restaurant.logoUrl);
  }

  /**
   * Serves the restaurant's current logo. The request only names the file;
   * the path on disk is rebuilt from the restaurant row, so nothing from the
   * URL reaches the file system and a stale or guessed name is a 404.
   */
  async openLogo(restaurantId: string, file: string): Promise<StreamableFile> {
    if (!UUID.test(restaurantId) || !LOGO_FILE.test(file)) throw notFound('NOT_FOUND', 'File not found');
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, logoUrl: true },
    });
    const current = restaurant ? this.ownFileOf(restaurant.id, restaurant.logoUrl) : null;
    if (!restaurant || !current || current !== file) throw notFound('NOT_FOUND', 'File not found');
    const full = path.join(this.root, 'logos', restaurant.id, current);
    let size: number;
    try {
      size = (await stat(full)).size;
    } catch {
      throw notFound('NOT_FOUND', 'File not found');
    }
    const ext = current.slice(current.lastIndexOf('.') + 1);
    return new StreamableFile(createReadStream(full), { type: CONTENT_TYPES[ext], length: size });
  }

  /** The file name of a logo URL this instance issued, or null for an external link. */
  ownFileOf(restaurantId: string, logoUrl: string | null): string | null {
    if (!logoUrl) return null;
    const prefix = `${this.publicApiUrl()}/uploads/logos/${restaurantId}/`;
    if (!logoUrl.startsWith(prefix)) return null;
    const name = logoUrl.slice(prefix.length);
    return LOGO_FILE.test(name) ? name : null;
  }

  private async removeOwnFile(restaurantId: string, logoUrl: string | null): Promise<void> {
    const name = this.ownFileOf(restaurantId, logoUrl);
    if (!name) return;
    try {
      await unlink(path.join(this.root, 'logos', restaurantId, name));
    } catch (error) {
      this.logger.warn(
        `previous logo ${name} could not be removed: ${error instanceof Error ? error.message : 'error'}`,
      );
    }
  }

  private publicApiUrl(): string {
    return this.config.getOrThrow<string>('PUBLIC_API_URL').replace(/\/+$/, '');
  }
}
