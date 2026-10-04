-- AlterTable
ALTER TABLE "site_pages" ADD COLUMN     "authorName" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'PAGE';

-- CreateIndex
CREATE INDEX "site_pages_restaurantId_kind_status_publishedAt_idx" ON "site_pages"("restaurantId", "kind", "status", "publishedAt");

