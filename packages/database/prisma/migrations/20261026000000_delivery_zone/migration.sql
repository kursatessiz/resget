-- Delivery zone: radius, minimum basket, fee by distance band (docs/VITRIN.md).
ALTER TABLE "restaurants" ADD COLUMN "deliveryZone" JSONB;
