-- CreateEnum
CREATE TYPE "TableTabStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "tabId" TEXT;

-- CreateTable
CREATE TABLE "table_tabs" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "status" "TableTabStatus" NOT NULL DEFAULT 'OPEN',
    "openKey" TEXT,
    "publicToken" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "table_tabs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "table_tabs_openKey_key" ON "table_tabs"("openKey");

-- CreateIndex
CREATE UNIQUE INDEX "table_tabs_publicToken_key" ON "table_tabs"("publicToken");

-- CreateIndex
CREATE INDEX "table_tabs_restaurantId_status_idx" ON "table_tabs"("restaurantId", "status");

-- CreateIndex
CREATE INDEX "orders_tabId_idx" ON "orders"("tabId");

-- AddForeignKey
ALTER TABLE "table_tabs" ADD CONSTRAINT "table_tabs_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_tabs" ADD CONSTRAINT "table_tabs_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "dining_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "table_tabs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

