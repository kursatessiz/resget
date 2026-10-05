-- AlterTable
ALTER TABLE "social_accounts" ADD COLUMN     "leadsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "meta_leads" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "socialAccountId" TEXT,
    "leadgenId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "formId" TEXT,
    "adId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedAt" TIMESTAMP(3),

    CONSTRAINT "meta_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meta_leads_restaurantId_receivedAt_idx" ON "meta_leads"("restaurantId", "receivedAt");

-- CreateIndex
CREATE INDEX "meta_leads_status_nextAttemptAt_idx" ON "meta_leads"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "meta_leads_restaurantId_leadgenId_key" ON "meta_leads"("restaurantId", "leadgenId");

-- AddForeignKey
ALTER TABLE "meta_leads" ADD CONSTRAINT "meta_leads_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_leads" ADD CONSTRAINT "meta_leads_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_leads" ADD CONSTRAINT "meta_leads_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "restaurant_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

