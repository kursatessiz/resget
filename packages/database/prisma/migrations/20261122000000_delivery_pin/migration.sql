-- AlterTable
ALTER TABLE "delivery_stops" ADD COLUMN     "codeAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "proof" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deliveryCode" TEXT;

