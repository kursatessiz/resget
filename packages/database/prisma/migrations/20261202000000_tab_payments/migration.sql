-- CreateTable
CREATE TABLE "tab_payments" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "tabId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "capturedAt" TIMESTAMP(3),
    "excessMinor" INTEGER NOT NULL DEFAULT 0,
    "excessRefundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tab_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tab_payments_tabId_idx" ON "tab_payments"("tabId");

-- AddForeignKey
ALTER TABLE "tab_payments" ADD CONSTRAINT "tab_payments_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tab_payments" ADD CONSTRAINT "tab_payments_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "table_tabs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

