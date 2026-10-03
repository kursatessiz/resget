-- AlterTable
ALTER TABLE "commission_invoices" ADD COLUMN     "collectionAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fiscalDocumentUrl" TEXT,
ADD COLUMN     "fiscalRef" TEXT,
ADD COLUMN     "lastCollectionAt" TIMESTAMP(3),
ADD COLUMN     "lastCollectionError" TEXT,
ADD COLUMN     "paymentMethodId" TEXT;

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "billingPaymentMethodId" TEXT,
ADD COLUMN     "listingSuspendedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "commission_invoices_status_dueAt_idx" ON "commission_invoices"("status", "dueAt");

-- AddForeignKey
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_billingPaymentMethodId_fkey" FOREIGN KEY ("billingPaymentMethodId") REFERENCES "saved_payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

