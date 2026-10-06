-- AlterTable
ALTER TABLE "restaurant_api_keys" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "restaurant_api_key_usage" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "restaurant_api_key_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restaurant_api_key_usage_restaurantId_day_idx" ON "restaurant_api_key_usage"("restaurantId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_api_key_usage_apiKeyId_day_key" ON "restaurant_api_key_usage"("apiKeyId", "day");

-- AddForeignKey
ALTER TABLE "restaurant_api_key_usage" ADD CONSTRAINT "restaurant_api_key_usage_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "restaurant_api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

