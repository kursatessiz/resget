-- Send approvals for automated flows (docs/ONAYLAR.md, docs/AKISLAR.md). Additive only: every new column is
-- nullable or has a default, so the previous release keeps working against it.

-- AlterTable
ALTER TABLE "journeys" ADD COLUMN     "approvalDecidedAt" TIMESTAMP(3),
ADD COLUMN     "approvalDecidedByUserId" TEXT,
ADD COLUMN     "approvalNote" TEXT,
ADD COLUMN     "approvalRequestedAt" TIMESTAMP(3),
ADD COLUMN     "approvalRequestedByUserId" TEXT,
ADD COLUMN     "approvalStatus" "CampaignApprovalStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "contentUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "contentUpdatedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "journey_runs_journeyId_sentAt_idx" ON "journey_runs"("journeyId", "sentAt");

-- AddForeignKey
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_approvalRequestedByUserId_fkey" FOREIGN KEY ("approvalRequestedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_approvalDecidedByUserId_fkey" FOREIGN KEY ("approvalDecidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Existing flows: the creator counts as the author of the current content, so they cannot approve it themselves.
UPDATE "journeys" SET "contentUpdatedByUserId" = "createdByUserId", "contentUpdatedAt" = "updatedAt";
