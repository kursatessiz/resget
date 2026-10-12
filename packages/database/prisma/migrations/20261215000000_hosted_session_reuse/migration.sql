-- One live hosted session per payment or tip (docs/ODEME.md, "Tek açık oturum"): the session handed out and when.
-- Expand only: nullable columns, older code keeps working.
ALTER TABLE "payments" ADD COLUMN "checkoutSession" JSONB,
ADD COLUMN "checkoutOpenedAt" TIMESTAMP(3);

ALTER TABLE "courier_tips" ADD COLUMN "checkoutSession" JSONB,
ADD COLUMN "checkoutOpenedAt" TIMESTAMP(3);
