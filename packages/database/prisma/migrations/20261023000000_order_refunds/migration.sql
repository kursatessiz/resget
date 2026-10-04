-- Partial refunds (docs/ODEME.md "Kismi iade", docs/MUTABAKAT.md "Kismi iade"): one row per refund with the
-- commission share it gave back. Additive; orders.commissionCreditInvoiceId stays until a later release.

-- CreateEnum
CREATE TYPE "OrderRefundSource" AS ENUM ('CANCELLATION', 'STAFF', 'CLAIM', 'PROVIDER', 'CHARGEBACK');

-- CreateTable
CREATE TABLE "order_refunds" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "source" "OrderRefundSource" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "commissionMinor" INTEGER NOT NULL DEFAULT 0,
    "commissionVatMinor" INTEGER NOT NULL DEFAULT 0,
    "items" JSONB,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "creditInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_refunds_orderId_createdAt_idx" ON "order_refunds"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "order_refunds_restaurantId_creditInvoiceId_idx" ON "order_refunds"("restaurantId", "creditInvoiceId");

-- AddForeignKey
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Orders whose whole commission was already cancelled before this release become one refund row each, so the
-- per-refund credits carry them on: a pending credit stays pending, a credited one keeps its invoice.
INSERT INTO "order_refunds" ("id", "restaurantId", "orderId", "source", "amountMinor", "currency", "commissionMinor", "commissionVatMinor", "reason", "creditInvoiceId", "createdAt")
SELECT
    gen_random_uuid()::text,
    o."restaurantId",
    o."id",
    CASE WHEN EXISTS (SELECT 1 FROM "payments" p WHERE p."orderId" = o."id" AND p."status" = 'CHARGED_BACK')
        THEN 'CHARGEBACK'::"OrderRefundSource" ELSE 'STAFF'::"OrderRefundSource" END,
    o."chargedToCustomerMinor",
    o."currency",
    o."platformCommissionMinor",
    o."commissionVatMinor",
    'recorded before per-refund bookkeeping',
    o."commissionCreditInvoiceId",
    o."commissionReversedAt"
FROM "orders" o
WHERE o."commissionReversedAt" IS NOT NULL;
