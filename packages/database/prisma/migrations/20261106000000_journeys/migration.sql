-- CreateTable
CREATE TABLE "journeys" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "delayHours" INTEGER NOT NULL DEFAULT 0,
    "inactiveDays" INTEGER,
    "cooldownDays" INTEGER NOT NULL DEFAULT 30,
    "attributionDays" INTEGER NOT NULL DEFAULT 3,
    "segmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PAUSED',
    "lastError" TEXT,
    "lastScanAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_runs" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "messageLogId" TEXT,
    "sentAt" TIMESTAMP(3),
    "convertedOrderId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "revenueMinor" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journey_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "journeys_restaurantId_createdAt_idx" ON "journeys"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "journeys_status_trigger_idx" ON "journeys"("status", "trigger");

-- CreateIndex
CREATE UNIQUE INDEX "journey_runs_convertedOrderId_key" ON "journey_runs"("convertedOrderId");

-- CreateIndex
CREATE INDEX "journey_runs_status_dueAt_idx" ON "journey_runs"("status", "dueAt");

-- CreateIndex
CREATE INDEX "journey_runs_journeyId_customerId_createdAt_idx" ON "journey_runs"("journeyId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "journey_runs_customerId_sentAt_idx" ON "journey_runs"("customerId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "journey_runs_journeyId_orderId_key" ON "journey_runs"("journeyId", "orderId");

-- AddForeignKey
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_runs" ADD CONSTRAINT "journey_runs_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_runs" ADD CONSTRAINT "journey_runs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "restaurant_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_runs" ADD CONSTRAINT "journey_runs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_runs" ADD CONSTRAINT "journey_runs_convertedOrderId_fkey" FOREIGN KEY ("convertedOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

