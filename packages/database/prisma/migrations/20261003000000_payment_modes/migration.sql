-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('OWN_POS', 'PLATFORM_PSP');

-- CreateEnum
CREATE TYPE "PaymentConnectionStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'FAILED', 'DISABLED');

-- CreateEnum
CREATE TYPE "CommissionInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'VOID');

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "invoiceId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paymentMode" "PaymentMode" NOT NULL DEFAULT 'OWN_POS',
ADD COLUMN     "platformReceivableMinor" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "paymentMode" "PaymentMode" NOT NULL DEFAULT 'OWN_POS',
ADD COLUMN     "savedPaymentMethodId" TEXT;

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "paymentMode" "PaymentMode" NOT NULL DEFAULT 'OWN_POS';

-- CreateTable
CREATE TABLE "payment_provider_connections" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "encryptedCredentials" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL,
    "status" "PaymentConnectionStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "label" TEXT NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_provider_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_payment_methods" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "expiryMonth" INTEGER NOT NULL,
    "expiryYear" INTEGER NOT NULL,
    "label" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_invoices" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "baseMinor" INTEGER NOT NULL,
    "commissionMinor" INTEGER NOT NULL,
    "vatMinor" INTEGER NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "status" "CommissionInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paymentRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_provider_connections_restaurantId_key" ON "payment_provider_connections"("restaurantId");

-- CreateIndex
CREATE INDEX "saved_payment_methods_userId_idx" ON "saved_payment_methods"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_payment_methods_userId_provider_tokenHash_key" ON "saved_payment_methods"("userId", "provider", "tokenHash");

-- CreateIndex
CREATE INDEX "commission_invoices_restaurantId_status_idx" ON "commission_invoices"("restaurantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "commission_invoices_restaurantId_periodStart_key" ON "commission_invoices"("restaurantId", "periodStart");

-- CreateIndex
CREATE INDEX "ledger_entries_invoiceId_idx" ON "ledger_entries"("invoiceId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_savedPaymentMethodId_fkey" FOREIGN KEY ("savedPaymentMethodId") REFERENCES "saved_payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_provider_connections" ADD CONSTRAINT "payment_provider_connections_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_payment_methods" ADD CONSTRAINT "saved_payment_methods_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_invoices" ADD CONSTRAINT "commission_invoices_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "commission_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

