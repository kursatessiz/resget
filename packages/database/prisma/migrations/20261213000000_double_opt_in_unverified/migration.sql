-- Owner's decision (docs/RIZA.md): an unverified number always confirms; the region list now only adds
-- confirmation for verified numbers and is empty by default.
-- AlterTable
ALTER TABLE "marketing_settings" ALTER COLUMN "doubleOptInRegions" SET DEFAULT ARRAY[]::TEXT[];

-- Rows still carrying the old default lose it; a list the platform owner changed is kept.
UPDATE "marketing_settings" SET "doubleOptInRegions" = ARRAY[]::TEXT[] WHERE "doubleOptInRegions" = ARRAY['EU_UK']::TEXT[];
