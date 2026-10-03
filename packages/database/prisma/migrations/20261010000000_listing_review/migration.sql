-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "listingRequestedAt" TIMESTAMP(3),
ADD COLUMN     "listingReviewNote" TEXT,
ADD COLUMN     "listingReviewedAt" TIMESTAMP(3);

