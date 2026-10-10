import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@resget/database';
import {
  GROUP_CART_MAX_PARTICIPANTS,
  GROUP_CART_TOKEN_BYTES,
  GROUP_CART_TTL_HOURS,
  OrderLineInputSchema,
  resolveLineModifiers,
} from '@resget/shared';
import type {
  GroupCartDTO,
  GroupCartLineDTO,
  GroupMembershipDTO,
  OrderLineInput,
  PublicOrderInput,
  PublicOrderResultDTO,
} from '@resget/shared';
import { conflict, forbidden, notFound } from '../../common/api-error';
import type { AuthUser } from '../auth/tenant-context';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorefrontService } from './storefront.service';

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
const newSecret = () => randomBytes(GROUP_CART_TOKEN_BYTES).toString('base64url');

function sameHash(key: string | undefined, hash: string): boolean {
  if (!key) return false;
  const given = Buffer.from(hashKey(key), 'hex');
  const stored = Buffer.from(hash, 'hex');
  return given.length === stored.length && timingSafeEqual(given, stored);
}

/** For sale: the item itself and its menu section are switched on (docs/VITRIN.md). */
function forSale(item: { isAvailable: boolean; category: { isActive: boolean } }): boolean {
  return item.isAvailable && item.category.isActive;
}

/** Stored lines were checked on write; anything unreadable counts as no lines. */
function storedLines(raw: Prisma.JsonValue): OrderLineInput[] {
  const parsed = OrderLineInputSchema.array().safeParse(raw);
  return parsed.success ? parsed.data : [];
}

const cartArgs = {
  include: {
    restaurant: { select: { id: true, slug: true, currency: true } },
    participants: { orderBy: { createdAt: 'asc' } },
  },
} satisfies Prisma.GroupCartDefaultArgs;
type CartRow = Prisma.GroupCartGetPayload<typeof cartArgs>;

/**
 * Group orders (docs/GRUP_SIPARISI.md): a shared basket where each browser
 * edits only its own lines and the host places one order for all. Prices
 * always come from the menu; the order itself goes through the restaurant
 * page's normal placement, so every rule of a single order applies.
 */
@Injectable()
export class GroupOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
    private readonly storefront: StorefrontService,
  ) {}

  async create(slug: string, name: string): Promise<GroupMembershipDTO> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { slug },
      select: { id: true, isActive: true, isPlatform: true },
    });
    if (!restaurant || !restaurant.isActive || restaurant.isPlatform)
      throw notFound('NOT_FOUND', 'Restaurant not found');
    await this.features.assertEnabled('group_orders', restaurant.id);
    const token = newSecret();
    const key = newSecret();
    const cart = await this.prisma.groupCart.create({
      data: {
        restaurantId: restaurant.id,
        token,
        expiresAt: new Date(Date.now() + GROUP_CART_TTL_HOURS * 3_600_000),
        participants: { create: { name, isHost: true, keyHash: hashKey(key) } },
      },
      include: { participants: true },
    });
    return { token, participantId: cart.participants[0].id, key };
  }

  async join(token: string, name: string): Promise<GroupMembershipDTO> {
    const cart = await this.openCart(token);
    if (cart.participants.length >= GROUP_CART_MAX_PARTICIPANTS)
      throw conflict('GROUP_CART_FULL', 'The basket is full');
    const key = newSecret();
    const participant = await this.prisma.groupCartParticipant.create({
      data: { cartId: cart.id, name, keyHash: hashKey(key) },
    });
    return { token, participantId: participant.id, key };
  }

  async get(token: string, key: string | undefined): Promise<GroupCartDTO> {
    return this.toDto(await this.load(token), key);
  }

  async setLines(
    token: string,
    participantId: string,
    key: string | undefined,
    lines: OrderLineInput[],
  ): Promise<GroupCartDTO> {
    const cart = await this.openCart(token);
    const participant = cart.participants.find((p) => p.id === participantId);
    if (!participant || !sameHash(key, participant.keyHash)) {
      throw forbidden('GROUP_CART_FORBIDDEN', 'Only the participant edits their own lines');
    }
    await this.checkLines(cart.restaurantId, lines);
    await this.prisma.groupCartParticipant.update({
      where: { id: participant.id },
      data: { lines: lines as unknown as Prisma.InputJsonValue },
    });
    return this.get(token, key);
  }

  /** The host closes the basket for changes before paying, or opens it again. */
  async setLocked(token: string, key: string | undefined, locked: boolean): Promise<GroupCartDTO> {
    const cart = await this.load(token);
    this.assertHost(cart, key);
    if (cart.status === 'PLACED' || cart.expiresAt.getTime() < Date.now()) {
      throw conflict('GROUP_CART_CLOSED', 'The basket is closed');
    }
    await this.prisma.groupCart.update({ where: { id: cart.id }, data: { status: locked ? 'LOCKED' : 'OPEN' } });
    return this.get(token, key);
  }

  /**
   * The host's checkout. The basket is claimed first with a conditional
   * write, so a double click cannot place two orders; a failed placement
   * gives it back locked. The client's own item list is replaced by
   * everyone's lines.
   */
  async place(
    token: string,
    key: string | undefined,
    input: PublicOrderInput,
    viewer: AuthUser | null,
    visitorId: string | null,
  ): Promise<PublicOrderResultDTO> {
    const cart = await this.load(token);
    this.assertHost(cart, key);
    const items = cart.participants.flatMap((p) => storedLines(p.lines));
    if (items.length === 0) throw conflict('GROUP_CART_EMPTY', 'Nobody has added anything yet');
    const claimed = await this.prisma.groupCart.updateMany({
      where: { id: cart.id, status: { in: ['OPEN', 'LOCKED'] }, expiresAt: { gt: new Date() } },
      data: { status: 'PLACED' },
    });
    if (claimed.count === 0) throw conflict('GROUP_CART_CLOSED', 'The basket is closed');
    try {
      const result = await this.storefront.placeBySlug(cart.restaurant.slug, { ...input, items }, viewer, visitorId);
      const order = await this.prisma.order.findUnique({
        where: { trackingToken: result.trackingToken },
        select: { id: true },
      });
      await this.prisma.groupCart.update({ where: { id: cart.id }, data: { orderId: order?.id ?? null } });
      return result;
    } catch (error) {
      await this.prisma.groupCart.update({ where: { id: cart.id }, data: { status: 'LOCKED' } });
      throw error;
    }
  }

  private async load(token: string): Promise<CartRow> {
    const cart = await this.prisma.groupCart.findUnique({ where: { token }, ...cartArgs });
    if (!cart) throw notFound('GROUP_CART_NOT_FOUND', 'No such basket');
    return cart;
  }

  private async openCart(token: string): Promise<CartRow> {
    const cart = await this.load(token);
    if (cart.status !== 'OPEN' || cart.expiresAt.getTime() < Date.now()) {
      throw conflict('GROUP_CART_CLOSED', 'The basket is closed');
    }
    return cart;
  }

  private assertHost(cart: CartRow, key: string | undefined): void {
    const host = cart.participants.find((p) => p.isHost);
    if (!host || !sameHash(key, host.keyHash)) throw forbidden('GROUP_CART_FORBIDDEN', 'Only the host can do this');
  }

  /** Every line must name an item of this restaurant that is for sale, with options the menu has at the menu's price. */
  private async checkLines(restaurantId: string, lines: OrderLineInput[]): Promise<void> {
    if (lines.length === 0) return;
    const items = await this.menuItems(restaurantId, lines);
    for (const line of lines) {
      const item = items.get(line.menuItemId);
      if (!item) throw notFound('NOT_FOUND', `Menu item ${line.menuItemId} not found`);
      if (!forSale(item)) throw conflict('MENU_ITEM_UNAVAILABLE', `${item.name} is not available`);
      const options = resolveLineModifiers(item.modifierGroups, line.modifiers);
      if (!options.ok) throw conflict(options.code, `Options of ${item.name} do not match the menu`);
    }
  }

  private async menuItems(restaurantId: string, lines: OrderLineInput[]) {
    const rows = await this.prisma.menuItem.findMany({
      where: { restaurantId, id: { in: [...new Set(lines.map((l) => l.menuItemId))] } },
      select: {
        id: true,
        name: true,
        priceMinor: true,
        isAvailable: true,
        category: { select: { isActive: true } },
        modifierGroups: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            minSelect: true,
            maxSelect: true,
            modifiers: {
              orderBy: { sortOrder: 'asc' },
              select: { id: true, name: true, priceDeltaMinor: true, isAvailable: true },
            },
          },
        },
      },
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async toDto(cart: CartRow, key: string | undefined): Promise<GroupCartDTO> {
    const all = cart.participants.map((p) => ({ participant: p, lines: storedLines(p.lines) }));
    const items = await this.menuItems(
      cart.restaurantId,
      all.flatMap((entry) => entry.lines),
    );
    const you = cart.participants.find((p) => sameHash(key, p.keyHash)) ?? null;
    const participants = all.map(({ participant, lines }) => {
      const priced: GroupCartLineDTO[] = lines.map((line) => {
        const item = items.get(line.menuItemId);
        const options = item ? resolveLineModifiers(item.modifierGroups, line.modifiers) : null;
        const delta = options?.ok ? options.modifiers.reduce((sum, m) => sum + m.priceDeltaMinor, 0) : 0;
        return {
          menuItemId: line.menuItemId,
          name: item?.name ?? '',
          quantity: line.quantity,
          modifiers: line.modifiers,
          unitPriceMinor: (item?.priceMinor ?? 0) + delta,
          available: Boolean(item && forSale(item) && options?.ok),
        };
      });
      return {
        id: participant.id,
        name: participant.name,
        isHost: participant.isHost,
        lines: priced,
        subtotalMinor: priced.reduce((sum, l) => sum + l.unitPriceMinor * l.quantity, 0),
      };
    });
    return {
      token: cart.token,
      restaurantSlug: cart.restaurant.slug,
      status: cart.status,
      currency: cart.restaurant.currency,
      expiresAt: cart.expiresAt.toISOString(),
      participants,
      totalMinor: participants.reduce((sum, p) => sum + p.subtotalMinor, 0),
      youId: you?.id ?? null,
      youAreHost: you?.isHost ?? false,
    };
  }
}
