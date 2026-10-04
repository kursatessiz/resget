-- Claim escalation to the platform console (docs/ODEME.md, "Eksik ürün bildirimi").
ALTER TYPE "OrderClaimStatus" ADD VALUE 'ESCALATED';

ALTER TABLE "order_claims" ADD COLUMN "escalatedAt" TIMESTAMP(3);

CREATE INDEX "order_claims_status_createdAt_idx" ON "order_claims"("status", "createdAt");
