-- Email open and click tracking for campaign recipients (docs/EPOSTA.md).
ALTER TABLE "campaign_recipients" ADD COLUMN "trackingToken" TEXT;
ALTER TABLE "campaign_recipients" ADD COLUMN "openedAt" TIMESTAMP(3);
ALTER TABLE "campaign_recipients" ADD COLUMN "openCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "campaign_recipients" ADD COLUMN "clickedAt" TIMESTAMP(3);
ALTER TABLE "campaign_recipients" ADD COLUMN "clickCount" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "campaign_recipients_trackingToken_key" ON "campaign_recipients"("trackingToken");
