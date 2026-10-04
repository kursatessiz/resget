-- Chargebacks and commission reversals (docs/MUTABAKAT.md, "Iade ve chargeback"). Additive only.
ALTER TYPE "PaymentStatus" ADD VALUE 'CHARGED_BACK';
ALTER TYPE "LedgerEntryType" ADD VALUE 'CHARGEBACK' BEFORE 'ADJUSTMENT';
ALTER TYPE "LedgerEntryType" ADD VALUE 'COMMISSION_REVERSAL' BEFORE 'ADJUSTMENT';
ALTER TYPE "LedgerEntryType" ADD VALUE 'COMMISSION_VAT_REVERSAL' BEFORE 'ADJUSTMENT';

-- OWN_POS commission bookkeeping per order.
ALTER TABLE "orders" ADD COLUMN "commissionInvoiceId" TEXT,
ADD COLUMN "commissionReversedAt" TIMESTAMP(3),
ADD COLUMN "commissionCreditInvoiceId" TEXT;

CREATE INDEX "orders_restaurantId_commissionInvoiceId_idx" ON "orders"("restaurantId", "commissionInvoiceId");
CREATE INDEX "orders_restaurantId_commissionCreditInvoiceId_idx" ON "orders"("restaurantId", "commissionCreditInvoiceId");
