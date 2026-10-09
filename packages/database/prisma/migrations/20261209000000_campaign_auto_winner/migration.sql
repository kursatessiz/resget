-- Automatic A/B winner (docs/KAMPANYALAR.md).
ALTER TABLE "campaigns" ADD COLUMN "autoWinnerTestPct" INTEGER;
ALTER TABLE "campaigns" ADD COLUMN "autoWinnerWaitHours" INTEGER;
ALTER TABLE "campaigns" ADD COLUMN "winnerVariant" TEXT;
ALTER TABLE "campaigns" ADD COLUMN "winnerDecidedAt" TIMESTAMP(3);
