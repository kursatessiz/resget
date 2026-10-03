-- CreateTable
CREATE TABLE "restaurant_api_keys" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_api_keys_keyId_key" ON "restaurant_api_keys"("keyId");

-- CreateIndex
CREATE INDEX "restaurant_api_keys_restaurantId_createdAt_idx" ON "restaurant_api_keys"("restaurantId", "createdAt");

-- AddForeignKey
ALTER TABLE "restaurant_api_keys" ADD CONSTRAINT "restaurant_api_keys_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_api_keys" ADD CONSTRAINT "restaurant_api_keys_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

