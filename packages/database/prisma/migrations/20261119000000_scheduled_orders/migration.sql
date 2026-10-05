-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "schedulingSettings" JSONB;

-- CreateIndex
CREATE INDEX "orders_restaurantId_scheduledFor_idx" ON "orders"("restaurantId", "scheduledFor");

