-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "acceptAlertSentAt" TIMESTAMP(3),
ADD COLUMN     "acceptDeadlineAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "orders_status_acceptDeadlineAt_idx" ON "orders"("status", "acceptDeadlineAt");


-- Orders already waiting for acceptance get the default window from their placement time.
UPDATE "orders" SET "acceptDeadlineAt" = "placedAt" + interval '10 minutes' WHERE "status" = 'PLACED' AND "acceptDeadlineAt" IS NULL;
