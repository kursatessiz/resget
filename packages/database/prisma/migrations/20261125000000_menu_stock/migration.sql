-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "stockQuantity" INTEGER;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "stockTaken" INTEGER NOT NULL DEFAULT 0;

