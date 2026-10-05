-- CreateEnum
CREATE TYPE "PayoutCadence" AS ENUM ('WEEKLY', 'DAILY', 'INSTANT');

-- AlterEnum
ALTER TYPE "LedgerEntryType" ADD VALUE 'PAYOUT_FEE';

-- AlterTable
ALTER TABLE "commission_invoices" ADD COLUMN     "deductedMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "payoutFeeMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "payoutFeeVatMinor" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "cadence" "PayoutCadence" NOT NULL DEFAULT 'WEEKLY',
ADD COLUMN     "feeMinor" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "payoutCadence" "PayoutCadence" NOT NULL DEFAULT 'WEEKLY';

-- CreateTable
CREATE TABLE "payout_schedule_options" (
    "id" TEXT NOT NULL,
    "cadence" "PayoutCadence" NOT NULL,
    "currency" TEXT NOT NULL,
    "feeBps" INTEGER NOT NULL DEFAULT 0,
    "feeFixedMinor" INTEGER NOT NULL DEFAULT 0,
    "settleBusinessDays" INTEGER NOT NULL,
    "requiresFastPayouts" BOOLEAN NOT NULL DEFAULT false,
    "freeWithFastPayouts" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_schedule_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payout_schedule_options_cadence_currency_key" ON "payout_schedule_options"("cadence", "currency");


-- fast_payouts is a new plan feature (docs/HAKEDIS_TAKVIMI.md): plans store exclusions, so BASIC leaves it out
-- explicitly and keeps meaning what it meant; PRO carries it.
UPDATE "plans" SET "excludedFeatures" = array_append("excludedFeatures", 'fast_payouts')
WHERE "code" = 'BASIC' AND NOT ('fast_payouts' = ANY("excludedFeatures"));
