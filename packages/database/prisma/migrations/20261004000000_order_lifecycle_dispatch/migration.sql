-- CreateEnum
CREATE TYPE "DeliveryTripStatus" AS ENUM ('PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryStopStatus" AS ENUM ('PENDING', 'EN_ROUTE', 'ARRIVING', 'DELIVERED', 'FAILED', 'REMOVED');

-- CreateEnum
CREATE TYPE "StopSequenceMode" AS ENUM ('MANUAL', 'OPTIMIZED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'HANDED_TO_COURIER';
ALTER TYPE "OrderStatus" ADD VALUE 'ARRIVING';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "estimatedDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "promisedReadyAt" TIMESTAMP(3),
ADD COLUMN     "trackingToken" TEXT;

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "dispatchSettings" JSONB;

-- CreateTable
CREATE TABLE "delivery_trips" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "courierMembershipId" TEXT,
    "createdByUserId" TEXT,
    "status" "DeliveryTripStatus" NOT NULL DEFAULT 'PLANNED',
    "sequenceMode" "StopSequenceMode" NOT NULL DEFAULT 'MANUAL',
    "plannedDistanceMeters" INTEGER,
    "plannedDurationSeconds" INTEGER,
    "assignedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_stops" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "DeliveryStopStatus" NOT NULL DEFAULT 'PENDING',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "distanceMeters" INTEGER,
    "etaAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_locations" (
    "membershipId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "tripId" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "headingDeg" DOUBLE PRECISION,
    "speedMps" DOUBLE PRECISION,
    "accuracyM" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courier_locations_pkey" PRIMARY KEY ("membershipId")
);

-- CreateTable
CREATE TABLE "courier_location_samples" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_location_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_trips_restaurantId_status_idx" ON "delivery_trips"("restaurantId", "status");

-- CreateIndex
CREATE INDEX "delivery_trips_courierMembershipId_status_idx" ON "delivery_trips"("courierMembershipId", "status");

-- CreateIndex
CREATE INDEX "delivery_stops_tripId_sequence_idx" ON "delivery_stops"("tripId", "sequence");

-- CreateIndex
CREATE INDEX "delivery_stops_orderId_status_idx" ON "delivery_stops"("orderId", "status");

-- CreateIndex
CREATE INDEX "courier_locations_restaurantId_idx" ON "courier_locations"("restaurantId");

-- CreateIndex
CREATE INDEX "courier_location_samples_tripId_recordedAt_idx" ON "courier_location_samples"("tripId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "orders_trackingToken_key" ON "orders"("trackingToken");

-- AddForeignKey
ALTER TABLE "delivery_trips" ADD CONSTRAINT "delivery_trips_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_trips" ADD CONSTRAINT "delivery_trips_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_trips" ADD CONSTRAINT "delivery_trips_courierMembershipId_fkey" FOREIGN KEY ("courierMembershipId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_trips" ADD CONSTRAINT "delivery_trips_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_stops" ADD CONSTRAINT "delivery_stops_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "delivery_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_stops" ADD CONSTRAINT "delivery_stops_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_stops" ADD CONSTRAINT "delivery_stops_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_locations" ADD CONSTRAINT "courier_locations_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_locations" ADD CONSTRAINT "courier_locations_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_location_samples" ADD CONSTRAINT "courier_location_samples_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "delivery_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_location_samples" ADD CONSTRAINT "courier_location_samples_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

