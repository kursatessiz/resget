-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ratingSum" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "order_ratings" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_ratings_orderId_key" ON "order_ratings"("orderId");

-- CreateIndex
CREATE INDEX "order_ratings_restaurantId_createdAt_idx" ON "order_ratings"("restaurantId", "createdAt");

-- AddForeignKey
ALTER TABLE "order_ratings" ADD CONSTRAINT "order_ratings_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_ratings" ADD CONSTRAINT "order_ratings_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

