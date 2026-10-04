-- Neighbour districts of a service area (docs/YOL_HARITASI.md). Additive only.
ALTER TABLE "service_areas" ADD COLUMN "neighbourDistricts" TEXT[] DEFAULT ARRAY[]::TEXT[];
