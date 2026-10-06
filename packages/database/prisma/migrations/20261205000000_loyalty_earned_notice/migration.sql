-- AlterTable
ALTER TABLE "loyalty_programs" ADD COLUMN     "notifyEarned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "loyalty_transactions" ADD COLUMN     "notifiedAt" TIMESTAMP(3);

