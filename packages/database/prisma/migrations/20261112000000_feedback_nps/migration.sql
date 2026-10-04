-- CreateTable
CREATE TABLE "feedback_settings" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "reviewUrl" TEXT,
    "alertMaxScore" INTEGER NOT NULL DEFAULT 2,
    "npsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_cases" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nps_responses" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nps_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feedback_settings_restaurantId_key" ON "feedback_settings"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_cases_orderId_key" ON "feedback_cases"("orderId");

-- CreateIndex
CREATE INDEX "feedback_cases_restaurantId_status_createdAt_idx" ON "feedback_cases"("restaurantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "nps_responses_orderId_key" ON "nps_responses"("orderId");

-- CreateIndex
CREATE INDEX "nps_responses_restaurantId_createdAt_idx" ON "nps_responses"("restaurantId", "createdAt");

-- AddForeignKey
ALTER TABLE "feedback_settings" ADD CONSTRAINT "feedback_settings_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_cases" ADD CONSTRAINT "feedback_cases_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_cases" ADD CONSTRAINT "feedback_cases_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nps_responses" ADD CONSTRAINT "nps_responses_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nps_responses" ADD CONSTRAINT "nps_responses_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

