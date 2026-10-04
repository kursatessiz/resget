-- AlterTable
ALTER TABLE "campaign_recipients" ADD COLUMN     "convertedAt" TIMESTAMP(3),
ADD COLUMN     "convertedOrderId" TEXT,
ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "revenueMinor" INTEGER,
ADD COLUMN     "variant" TEXT NOT NULL DEFAULT 'A';

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "attributionDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "sendTimeMode" TEXT NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "subject" TEXT,
ADD COLUMN     "variantBody" TEXT,
ADD COLUMN     "variantSharePct" INTEGER,
ADD COLUMN     "variantSubject" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_convertedOrderId_key" ON "campaign_recipients"("convertedOrderId");

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_convertedOrderId_fkey" FOREIGN KEY ("convertedOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

