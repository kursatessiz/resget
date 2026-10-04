-- Refund attempts on payments (docs/ODEME.md, "İade"). Additive only.
ALTER TABLE "payments" ADD COLUMN "refundRequestedAt" TIMESTAMP(3),
ADD COLUMN "refundLastAttemptAt" TIMESTAMP(3),
ADD COLUMN "refundAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "refundFailureCode" TEXT,
ADD COLUMN "refundedAt" TIMESTAMP(3),
ADD COLUMN "refundProviderRef" TEXT;

-- CreateIndex
CREATE INDEX "payments_status_refundFailureCode_idx" ON "payments"("status", "refundFailureCode");
