-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "dietaryTags" TEXT[] DEFAULT ARRAY[]::TEXT[];

