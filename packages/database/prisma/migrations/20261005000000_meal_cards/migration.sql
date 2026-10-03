-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paymentMethod" "PaymentMethod",
ADD COLUMN     "paymentProvider" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "collectedByUserId" TEXT;

-- CreateTable
CREATE TABLE "meal_card_connections" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "acceptsOnline" BOOLEAN NOT NULL DEFAULT false,
    "acceptsOnDelivery" BOOLEAN NOT NULL DEFAULT true,
    "encryptedCredentials" TEXT,
    "keyVersion" TEXT,
    "status" "PaymentConnectionStatus" NOT NULL DEFAULT 'DISABLED',
    "label" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_card_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meal_card_connections_restaurantId_providerCode_key" ON "meal_card_connections"("restaurantId", "providerCode");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_collectedByUserId_fkey" FOREIGN KEY ("collectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_card_connections" ADD CONSTRAINT "meal_card_connections_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

