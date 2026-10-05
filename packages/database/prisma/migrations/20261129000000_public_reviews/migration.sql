-- AlterTable
ALTER TABLE "order_ratings" ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "hiddenAt" TIMESTAMP(3),
ADD COLUMN     "hiddenByUserId" TEXT,
ADD COLUMN     "hiddenReason" TEXT,
ADD COLUMN     "reply" TEXT,
ADD COLUMN     "replyByUserId" TEXT,
ADD COLUMN     "replyCreatedAt" TIMESTAMP(3),
ADD COLUMN     "replyEditedAt" TIMESTAMP(3),
ADD COLUMN     "reportNote" TEXT,
ADD COLUMN     "reportReason" TEXT,
ADD COLUMN     "reportResolvedAt" TIMESTAMP(3),
ADD COLUMN     "reportedAt" TIMESTAMP(3),
ADD COLUMN     "reportedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "order_ratings_reportedAt_idx" ON "order_ratings"("reportedAt");

