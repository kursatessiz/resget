import type { Prisma, PrismaClient } from '@resget/database';

/**
 * Test teardown only. Money and consent records refuse a cascading delete
 * (docs/VERI_MODELI.md, "Silme kuralı"), so a restaurant a suite created is
 * removed by clearing its money rows first. The application itself never
 * deletes a restaurant.
 */
export async function deleteTestRestaurants(prisma: PrismaClient, where: Prisma.RestaurantWhereInput): Promise<void> {
  const ids = (await prisma.restaurant.findMany({ where, select: { id: true } })).map((r) => r.id);
  if (ids.length === 0) return;
  const scope = { restaurantId: { in: ids } };
  await prisma.$transaction([
    prisma.tabPayment.deleteMany({ where: scope }),
    prisma.courierTip.deleteMany({ where: scope }),
    prisma.orderRefund.deleteMany({ where: scope }),
    prisma.payment.deleteMany({ where: scope }),
    prisma.ledgerEntry.deleteMany({ where: scope }),
    prisma.payout.deleteMany({ where: scope }),
    prisma.commissionInvoice.deleteMany({ where: scope }),
    prisma.order.deleteMany({ where: scope }),
    prisma.restaurant.deleteMany({ where: { id: { in: ids } } }),
  ]);
}
