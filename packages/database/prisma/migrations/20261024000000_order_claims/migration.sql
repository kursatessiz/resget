-- Missing-item claims (docs/ODEME.md "Eksik urun bildirimi"). Additive only.
-- CreateEnum
CREATE TYPE "OrderClaimStatus" AS ENUM ('OPEN', 'APPROVED', 'DECLINED');

-- AlterTable
ALTER TABLE "order_refunds" ADD COLUMN     "claimId" TEXT;

-- CreateTable
CREATE TABLE "order_claims" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "OrderClaimStatus" NOT NULL DEFAULT 'OPEN',
    "items" JSONB NOT NULL,
    "requestedMinor" INTEGER NOT NULL,
    "note" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_claims_orderId_createdAt_idx" ON "order_claims"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "order_claims_restaurantId_status_idx" ON "order_claims"("restaurantId", "status");

-- AddForeignKey
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "order_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_claims" ADD CONSTRAINT "order_claims_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_claims" ADD CONSTRAINT "order_claims_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_claims" ADD CONSTRAINT "order_claims_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

