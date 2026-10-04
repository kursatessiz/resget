-- AlterTable
ALTER TABLE "restaurant_customers" ADD COLUMN     "consentChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "isBusiness" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "contact_consents" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "legalBasis" TEXT NOT NULL DEFAULT 'CONSENT',
    "source" TEXT NOT NULL,
    "note" TEXT,
    "formVersion" TEXT,
    "confirmationRequestedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "registrySyncedAt" TIMESTAMP(3),
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_confirmations" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_settings" (
    "restaurantId" TEXT NOT NULL,
    "dailyCap" INTEGER NOT NULL DEFAULT 1,
    "weeklyCap" INTEGER NOT NULL DEFAULT 3,
    "doubleOptInRegions" TEXT[] DEFAULT ARRAY['EU_UK']::TEXT[],
    "merchantExemption" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_settings_pkey" PRIMARY KEY ("restaurantId")
);

-- CreateIndex
CREATE INDEX "contact_consents_customerId_channel_createdAt_idx" ON "contact_consents"("customerId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "contact_consents_restaurantId_registrySyncedAt_idx" ON "contact_consents"("restaurantId", "registrySyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "consent_confirmations_tokenHash_key" ON "consent_confirmations"("tokenHash");

-- CreateIndex
CREATE INDEX "consent_confirmations_customerId_idx" ON "consent_confirmations"("customerId");

-- CreateIndex
CREATE INDEX "campaign_recipients_customerId_sentAt_idx" ON "campaign_recipients"("customerId", "sentAt");

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "restaurant_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_confirmations" ADD CONSTRAINT "consent_confirmations_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_confirmations" ADD CONSTRAINT "consent_confirmations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "restaurant_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_settings" ADD CONSTRAINT "marketing_settings_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill (docs/RIZA.md): the single checkbox read "by SMS or WhatsApp", so an
-- existing opt-in becomes a consent on both channels, dated when it was given.
INSERT INTO "contact_consents" ("id", "restaurantId", "customerId", "channel", "granted", "legalBasis", "source", "createdAt")
SELECT gen_random_uuid()::text, c."restaurantId", c."id", ch.channel, true, 'CONSENT', 'LEGACY',
       COALESCE(c."marketingOptInAt", c."createdAt")
FROM "restaurant_customers" c
CROSS JOIN (VALUES ('SMS'), ('WHATSAPP')) AS ch(channel)
WHERE c."marketingOptIn" = true;

-- An earlier opt-out link click becomes a refusal on both channels.
INSERT INTO "contact_consents" ("id", "restaurantId", "customerId", "channel", "granted", "legalBasis", "source", "createdAt")
SELECT gen_random_uuid()::text, c."restaurantId", c."id", ch.channel, false, 'CONSENT', 'OPT_OUT_LINK', c."marketingOptOutAt"
FROM "restaurant_customers" c
CROSS JOIN (VALUES ('SMS'), ('WHATSAPP')) AS ch(channel)
WHERE c."marketingOptIn" = false AND c."marketingOptOutAt" IS NOT NULL;

UPDATE "restaurant_customers" SET "consentChannels" = ARRAY['SMS', 'WHATSAPP']::TEXT[] WHERE "marketingOptIn" = true;

-- Contacts of the platform tenant that came from a restaurant sign-up or the site form are restaurant owners.
UPDATE "restaurant_customers" c SET "isBusiness" = true
FROM "restaurants" r
WHERE r."id" = c."restaurantId" AND r."isPlatform" = true AND c."source" IN ('signup', 'site_form');
