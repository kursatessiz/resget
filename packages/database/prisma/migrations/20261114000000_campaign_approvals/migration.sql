-- CreateEnum
CREATE TYPE "CampaignApprovalStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "approvalDecidedAt" TIMESTAMP(3),
ADD COLUMN     "approvalDecidedByUserId" TEXT,
ADD COLUMN     "approvalNote" TEXT,
ADD COLUMN     "approvalRequestedAt" TIMESTAMP(3),
ADD COLUMN     "approvalRequestedByUserId" TEXT,
ADD COLUMN     "approvalStatus" "CampaignApprovalStatus" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "campaign_send_limits" (
    "restaurantId" TEXT NOT NULL,
    "maxPerCampaign" INTEGER,
    "maxPerDay" INTEGER,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_send_limits_pkey" PRIMARY KEY ("restaurantId")
);

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_approvalRequestedByUserId_fkey" FOREIGN KEY ("approvalRequestedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_approvalDecidedByUserId_fkey" FOREIGN KEY ("approvalDecidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_send_limits" ADD CONSTRAINT "campaign_send_limits_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

