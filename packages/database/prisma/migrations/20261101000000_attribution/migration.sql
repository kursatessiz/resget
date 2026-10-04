-- CreateTable
CREATE TABLE "visitors" (
    "restaurantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("restaurantId","id")
);

-- CreateTable
CREATE TABLE "touchpoints" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "landingHost" TEXT NOT NULL,
    "landingPath" TEXT NOT NULL,
    "referrerHost" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmTerm" TEXT,
    "utmContent" TEXT,
    "utmId" TEXT,
    "campaignId" TEXT,
    "adsetId" TEXT,
    "adId" TEXT,
    "refCode" TEXT,
    "adPlatform" TEXT,
    "clickIds" JSONB,
    "advertisingConsent" BOOLEAN NOT NULL DEFAULT false,
    "untaggedPaid" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "countryCode" TEXT,
    "deviceType" TEXT,
    "tableId" TEXT,
    "customerId" TEXT,

    CONSTRAINT "touchpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_events" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerId" TEXT,
    "valueMinor" INTEGER,
    "currency" TEXT,
    "sourceKind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "attributedTouchpointId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversion_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visitors_customerId_idx" ON "visitors"("customerId");

-- CreateIndex
CREATE INDEX "touchpoints_restaurantId_occurredAt_idx" ON "touchpoints"("restaurantId", "occurredAt");

-- CreateIndex
CREATE INDEX "touchpoints_restaurantId_visitorId_occurredAt_idx" ON "touchpoints"("restaurantId", "visitorId", "occurredAt");

-- CreateIndex
CREATE INDEX "touchpoints_customerId_occurredAt_idx" ON "touchpoints"("customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "conversion_events_restaurantId_occurredAt_idx" ON "conversion_events"("restaurantId", "occurredAt");

-- CreateIndex
CREATE INDEX "conversion_events_customerId_idx" ON "conversion_events"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "conversion_events_restaurantId_sourceKind_sourceId_key" ON "conversion_events"("restaurantId", "sourceKind", "sourceId");

-- AddForeignKey
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "restaurant_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touchpoints" ADD CONSTRAINT "touchpoints_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touchpoints" ADD CONSTRAINT "touchpoints_restaurantId_visitorId_fkey" FOREIGN KEY ("restaurantId", "visitorId") REFERENCES "visitors"("restaurantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touchpoints" ADD CONSTRAINT "touchpoints_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "dining_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touchpoints" ADD CONSTRAINT "touchpoints_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "restaurant_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "restaurant_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_attributedTouchpointId_fkey" FOREIGN KEY ("attributedTouchpointId") REFERENCES "touchpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

