import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@resget/database';
import { GeoPointSchema, orderShortCode, trackingUrl } from '@resget/shared';
import type {
  CustomerAccountDTO,
  CustomerAddressDTO,
  CustomerOrderDTO,
  SaveAddressInput,
  StorefrontViewerDTO,
  UpdateAddressInput,
  UpdateProfileInput,
} from '@resget/shared';
import { WalletsService } from '../payments/wallets.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { notFound } from '../../common/api-error';

const addressSelect = Prisma.validator<Prisma.CustomerAddressSelect>()({
  id: true,
  label: true,
  addressLine: true,
  city: true,
  district: true,
  postalCode: true,
  note: true,
  lat: true,
  lng: true,
  isDefault: true,
});
type AddressRow = Prisma.CustomerAddressGetPayload<{ select: typeof addressSelect }>;

/** Scalar columns of an address as the client may set them; shared by create and update. */
interface AddressData {
  label?: string;
  addressLine?: string;
  city?: string;
  district?: string;
  postalCode?: string;
  note?: string;
  lat?: number | null;
  lng?: number | null;
}

/** The customer's account (docs/VITRIN.md): saved addresses, profile and the orders placed with that phone. */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly loyalty: LoyaltyService,
    private readonly geocoding: GeocodingService,
    private readonly wallets: WalletsService,
  ) {}

  async account(userId: string): Promise<CustomerAccountDTO> {
    const [user, addresses, orders, loyalty] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { fullName: true, phone: true, locale: true },
      }),
      this.addresses(userId),
      this.orders(userId),
      this.loyalty.balancesOf(userId),
    ]);
    return { user, addresses, orders, loyalty };
  }

  /** What the storefront prefills for a signed-in visitor. */
  async viewer(userId: string, restaurantId: string | null = null): Promise<StorefrontViewerDTO> {
    const [user, addresses, loyaltyPoints, loyaltyTier, walletCards] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, phone: true } }),
      this.addresses(userId),
      restaurantId ? this.loyalty.balanceOf(restaurantId, userId) : Promise.resolve(null),
      restaurantId ? this.loyalty.tierOf(restaurantId, userId) : Promise.resolve(null),
      restaurantId ? this.wallets.usableCardsAt(userId, restaurantId) : Promise.resolve([]),
    ]);
    return { fullName: user.fullName, phone: user.phone, addresses, loyaltyPoints, loyaltyTier, walletCards };
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<CustomerAccountDTO> {
    await this.prisma.user.update({ where: { id: userId }, data: input });
    return this.account(userId);
  }

  async addresses(userId: string): Promise<CustomerAddressDTO[]> {
    const rows = await this.prisma.customerAddress.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: addressSelect,
    });
    return rows.map(toAddress);
  }

  async addAddress(userId: string, input: SaveAddressInput): Promise<CustomerAddressDTO[]> {
    const count = await this.prisma.customerAddress.count({ where: { userId } });
    const makeDefault = input.isDefault === true || count === 0;
    // No country or bias is known for a person's own address book; the provider searches the text as is.
    const point = input.point ?? (await this.geocoding.pointFor(input, null, null));
    await this.prisma.$transaction(async (tx) => {
      if (makeDefault) await tx.customerAddress.updateMany({ where: { userId }, data: { isDefault: false } });
      await tx.customerAddress.create({
        data: {
          userId,
          label: input.label,
          addressLine: input.addressLine,
          city: input.city,
          district: input.district,
          postalCode: input.postalCode,
          note: input.note,
          lat: point?.lat ?? null,
          lng: point?.lng ?? null,
          isDefault: makeDefault,
        },
      });
    });
    return this.addresses(userId);
  }

  async updateAddress(userId: string, addressId: string, input: UpdateAddressInput): Promise<CustomerAddressDTO[]> {
    const existing = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, userId },
      select: { id: true },
    });
    if (!existing) throw notFound('ADDRESS_NOT_FOUND', 'Address not found');
    await this.prisma.$transaction(async (tx) => {
      if (input.isDefault === true)
        await tx.customerAddress.updateMany({ where: { userId }, data: { isDefault: false } });
      await tx.customerAddress.update({
        where: { id: addressId },
        data: { ...this.toData(input), ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}) },
      });
    });
    return this.addresses(userId);
  }

  async removeAddress(userId: string, addressId: string): Promise<CustomerAddressDTO[]> {
    const deleted = await this.prisma.customerAddress.deleteMany({ where: { id: addressId, userId } });
    if (deleted.count === 0) throw notFound('ADDRESS_NOT_FOUND', 'Address not found');
    // The list never ends up without a default while it has entries.
    const remaining = await this.prisma.customerAddress.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
    const hasDefault = await this.prisma.customerAddress.count({ where: { userId, isDefault: true } });
    if (remaining && hasDefault === 0) {
      await this.prisma.customerAddress.update({ where: { id: remaining.id }, data: { isDefault: true } });
    }
    return this.addresses(userId);
  }

  /** The orders placed with this phone, newest first, with their tracking links. */
  async orders(userId: string): Promise<CustomerOrderDTO[]> {
    const rows = await this.prisma.order.findMany({
      where: { customerUserId: userId },
      orderBy: { placedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        trackingToken: true,
        status: true,
        fulfillment: true,
        chargedToCustomerMinor: true,
        currency: true,
        placedAt: true,
        completedAt: true,
        restaurant: { select: { name: true, slug: true, logoUrl: true } },
        items: { select: { quantity: true } },
      },
    });
    const appUrl = this.config.getOrThrow<string>('PUBLIC_APP_URL');
    return rows.map((o) => ({
      id: o.id,
      shortCode: orderShortCode(o.id),
      trackingUrl: o.trackingToken ? trackingUrl(appUrl, o.trackingToken) : null,
      restaurant: o.restaurant,
      status: o.status,
      fulfillment: o.fulfillment,
      chargedToCustomerMinor: o.chargedToCustomerMinor,
      currency: o.currency,
      itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
      placedAt: o.placedAt.toISOString(),
      completedAt: o.completedAt?.toISOString() ?? null,
    }));
  }

  private toData(input: Partial<SaveAddressInput>): AddressData {
    const data: AddressData = {};
    if (input.label !== undefined) data.label = input.label;
    if (input.addressLine !== undefined) data.addressLine = input.addressLine;
    if (input.city !== undefined) data.city = input.city;
    if (input.district !== undefined) data.district = input.district;
    if (input.postalCode !== undefined) data.postalCode = input.postalCode;
    if (input.note !== undefined) data.note = input.note;
    if (input.point !== undefined) {
      data.lat = input.point?.lat ?? null;
      data.lng = input.point?.lng ?? null;
    }
    return data;
  }
}

function toAddress(row: AddressRow): CustomerAddressDTO {
  const point = row.lat !== null && row.lng !== null ? GeoPointSchema.safeParse({ lat: row.lat, lng: row.lng }) : null;
  return {
    id: row.id,
    label: row.label,
    addressLine: row.addressLine,
    city: row.city,
    district: row.district,
    postalCode: row.postalCode,
    note: row.note,
    point: point?.success ? point.data : null,
    isDefault: row.isDefault,
  };
}
