import type { trCourier } from '../tr/courier';

export const enCourier: Record<keyof typeof trCourier, string> = {
  'courier.title': 'Courier',
  'courier.mode.RESTAURANT_COURIER': 'My own courier',
  'courier.mode.THIRD_PARTY_API': 'Partner courier network',
  'courier.mode.NONE': 'No delivery (pickup and dine in)',
  'courier.quote.get': 'Get a courier quote',
  'courier.quote.fee': 'Courier fee',
  'courier.quote.eta': 'Estimated delivery: {minutes} min',
  'courier.quote.expires': 'Quote valid until {time}',
  'courier.dispatch': 'Request a courier',
  'courier.cancel': 'Cancel the courier',
  'courier.feePolicy.title': 'Delivery fee shown to the customer',
  'courier.feePolicy.PASS_THROUGH': 'Pass the courier fee through',
  'courier.feePolicy.FIXED': 'Fixed fee',
  'courier.feePolicy.FREE_ABOVE': 'Free above a basket amount',
  'courier.separateFromCommission': 'The courier fee is a service separate from the platform commission.',
};
