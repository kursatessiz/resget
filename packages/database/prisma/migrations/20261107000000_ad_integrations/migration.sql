-- CreateTable
CREATE TABLE "ad_connections" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "encryptedCredentials" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL,
    "publicConfig" JSONB NOT NULL,
    "sendTypes" TEXT[],
    "enhancedMatching" BOOLEAN NOT NULL DEFAULT false,
    "lastSentAt" TIMESTAMP(3),
    "lastSpendSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_conversion_deliveries" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "conversionEventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorCode" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_conversion_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_spend_daily" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "campaignRef" TEXT NOT NULL,
    "campaignName" TEXT,
    "spendMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_spend_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ad_connections_restaurantId_platform_key" ON "ad_connections"("restaurantId", "platform");

-- CreateIndex
CREATE INDEX "ad_conversion_deliveries_status_nextAttemptAt_idx" ON "ad_conversion_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "ad_conversion_deliveries_connectionId_conversionEventId_key" ON "ad_conversion_deliveries"("connectionId", "conversionEventId");

-- CreateIndex
CREATE INDEX "ad_spend_daily_restaurantId_date_idx" ON "ad_spend_daily"("restaurantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ad_spend_daily_connectionId_date_campaignRef_key" ON "ad_spend_daily"("connectionId", "date", "campaignRef");

-- AddForeignKey
ALTER TABLE "ad_connections" ADD CONSTRAINT "ad_connections_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_conversion_deliveries" ADD CONSTRAINT "ad_conversion_deliveries_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ad_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_conversion_deliveries" ADD CONSTRAINT "ad_conversion_deliveries_conversionEventId_fkey" FOREIGN KEY ("conversionEventId") REFERENCES "conversion_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_spend_daily" ADD CONSTRAINT "ad_spend_daily_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ad_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_spend_daily" ADD CONSTRAINT "ad_spend_daily_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

