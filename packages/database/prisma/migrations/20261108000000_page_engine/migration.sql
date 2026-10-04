-- CreateTable
CREATE TABLE "site_pages" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "blocks" JSONB NOT NULL,
    "translationKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_pages_restaurantId_translationKey_idx" ON "site_pages"("restaurantId", "translationKey");

-- CreateIndex
CREATE UNIQUE INDEX "site_pages_restaurantId_locale_path_key" ON "site_pages"("restaurantId", "locale", "path");

-- AddForeignKey
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

