-- CreateEnum
CREATE TYPE "GroupCartStatus" AS ENUM ('OPEN', 'LOCKED', 'PLACED');

-- CreateTable
CREATE TABLE "group_carts" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "GroupCartStatus" NOT NULL DEFAULT 'OPEN',
    "orderId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_cart_participants" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isHost" BOOLEAN NOT NULL DEFAULT false,
    "keyHash" TEXT NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_cart_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "group_carts_token_key" ON "group_carts"("token");

-- CreateIndex
CREATE UNIQUE INDEX "group_carts_orderId_key" ON "group_carts"("orderId");

-- CreateIndex
CREATE INDEX "group_carts_restaurantId_createdAt_idx" ON "group_carts"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "group_cart_participants_cartId_idx" ON "group_cart_participants"("cartId");

-- AddForeignKey
ALTER TABLE "group_carts" ADD CONSTRAINT "group_carts_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_carts" ADD CONSTRAINT "group_carts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_cart_participants" ADD CONSTRAINT "group_cart_participants_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "group_carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

