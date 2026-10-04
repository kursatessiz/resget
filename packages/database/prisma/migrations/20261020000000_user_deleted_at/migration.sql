-- Account deletion (docs/KISISEL_VERI.md). Additive only.
ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);
