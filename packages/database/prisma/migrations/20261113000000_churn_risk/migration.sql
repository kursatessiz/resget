-- CreateEnum
CREATE TYPE "ChurnRisk" AS ENUM ('NEW', 'ACTIVE', 'NOT_RETURNED', 'AT_RISK', 'LOST');

-- AlterTable
ALTER TABLE "restaurant_customers" ADD COLUMN     "churnRisk" "ChurnRisk";

-- CreateIndex
CREATE INDEX "restaurant_customers_restaurantId_churnRisk_idx" ON "restaurant_customers"("restaurantId", "churnRisk");

