-- Courier tip refund from the panel (docs/BAHSIS.md).
ALTER TABLE "courier_tips" ADD COLUMN "refundRequestedAt" TIMESTAMP(3);
ALTER TABLE "courier_tips" ADD COLUMN "refundReason" TEXT;
ALTER TABLE "courier_tips" ADD COLUMN "refundedByUserId" TEXT;
ALTER TABLE "courier_tips" ADD COLUMN "refundProviderRef" TEXT;
