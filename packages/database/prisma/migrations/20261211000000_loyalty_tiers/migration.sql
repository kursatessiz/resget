-- Loyalty tiers (docs/SADAKAT.md, "Seviyeler").
ALTER TABLE "loyalty_programs" ADD COLUMN "tiers" JSONB NOT NULL DEFAULT '[]';
