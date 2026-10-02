import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { CourierRegistry } from './courier.registry';
import { CourierService } from './courier.service';
import { MOCK_BASE_FEE_MINOR } from './mock-courier.adapter';

const stop = {
  address: 'Caferaga Mah. Moda Cad. No 1',
  point: { lat: 40.9867, lng: 29.0263 },
  contactName: 'A',
  contactPhone: '+905321112233',
};
const request = {
  pickup: stop,
  dropoff: { ...stop, point: { lat: 40.99, lng: 29.03 } },
  parcelValueMinor: 70000,
  currency: 'TRY',
};

describe('CourierService', () => {
  const prisma = { restaurant: { findUnique: jest.fn() } };
  const registry = new CourierRegistry({ get: () => undefined } as unknown as ConfigService);
  const service = new CourierService(prisma as never, registry);

  beforeEach(() => jest.resetAllMocks());

  it('quotes through the restaurant network and applies its fee policy', async () => {
    prisma.restaurant.findUnique.mockResolvedValue({
      deliveryMode: 'THIRD_PARTY_API',
      deliveryFeePolicy: { mode: 'PASS_THROUGH', roundUpToMinor: 500 },
      courierProvider: { code: 'MOCK', isActive: true },
    });
    const result = await service.quoteFor('r1', request, 70000);
    expect(result.quote.providerCode).toBe('MOCK');
    expect(result.quote.feeMinor).toBeGreaterThan(MOCK_BASE_FEE_MINOR);
    expect(result.customerFeeMinor % 500).toBe(0);
    expect(result.customerFeeMinor).toBeGreaterThanOrEqual(result.quote.feeMinor);
    expect(result.restaurantSubsidyMinor).toBeLessThanOrEqual(0);
  });

  it('refuses when the restaurant uses its own courier', async () => {
    prisma.restaurant.findUnique.mockResolvedValue({
      deliveryMode: 'RESTAURANT_COURIER',
      deliveryFeePolicy: null,
      courierProvider: null,
    });
    await expect(service.quoteFor('r1', request, 70000)).rejects.toThrow(ForbiddenException);
  });
});
