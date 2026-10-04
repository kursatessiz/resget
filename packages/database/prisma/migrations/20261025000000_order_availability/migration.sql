-- Order availability: pause and busy mode (docs/SIPARIS_VE_SEVK.md).
ALTER TABLE "restaurants" ADD COLUMN "ordersPausedUntil" TIMESTAMP(3),
ADD COLUMN "busyExtraMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "busyUntil" TIMESTAMP(3);
