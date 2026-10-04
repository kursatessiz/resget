-- Platform tenant for platform marketing (docs/PAZARLAMA.md).
ALTER TABLE "restaurants" ADD COLUMN "isPlatform" BOOLEAN NOT NULL DEFAULT false;

-- At most one platform tenant.
CREATE UNIQUE INDEX "restaurants_single_platform_key" ON "restaurants" ("isPlatform") WHERE "isPlatform" = true;

ALTER TABLE "role_templates" ADD COLUMN "systemKey" TEXT;
