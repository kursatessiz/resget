-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "segmentId" TEXT;

-- CreateTable
CREATE TABLE "segments" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rule" JSONB NOT NULL,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "snapshotAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment_members" (
    "segmentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,

    CONSTRAINT "segment_members_pkey" PRIMARY KEY ("segmentId","customerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "segments_restaurantId_name_key" ON "segments"("restaurantId", "name");

-- CreateIndex
CREATE INDEX "segment_members_customerId_idx" ON "segment_members"("customerId");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "restaurant_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

