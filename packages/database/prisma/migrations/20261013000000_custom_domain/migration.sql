-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "customDomain" TEXT,
ADD COLUMN     "customDomainVerifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "restaurants_customDomain_key" ON "restaurants"("customDomain");

