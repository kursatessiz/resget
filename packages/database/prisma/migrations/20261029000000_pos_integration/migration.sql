-- POS integration (docs/POS_ENTEGRASYONU.md).
-- CreateEnum
CREATE TYPE "PosConnectionStatus" AS ENUM ('ACTIVE', 'FAILED');

-- CreateEnum
CREATE TYPE "PosSyncStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "pos_connections" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "encryptedCredentials" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "PosConnectionStatus" NOT NULL,
    "failureReason" TEXT,
    "autoAccept" BOOLEAN NOT NULL DEFAULT false,
    "defaultPrepMinutes" INTEGER NOT NULL DEFAULT 20,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_order_syncs" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "PosSyncStatus" NOT NULL DEFAULT 'PENDING',
    "externalRef" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_order_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pos_connections_restaurantId_key" ON "pos_connections"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_order_syncs_orderId_key" ON "pos_order_syncs"("orderId");

-- CreateIndex
CREATE INDEX "pos_order_syncs_status_nextAttemptAt_idx" ON "pos_order_syncs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "pos_order_syncs_connectionId_externalRef_idx" ON "pos_order_syncs"("connectionId", "externalRef");

-- AddForeignKey
ALTER TABLE "pos_connections" ADD CONSTRAINT "pos_connections_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_order_syncs" ADD CONSTRAINT "pos_order_syncs_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_order_syncs" ADD CONSTRAINT "pos_order_syncs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "pos_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_order_syncs" ADD CONSTRAINT "pos_order_syncs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

