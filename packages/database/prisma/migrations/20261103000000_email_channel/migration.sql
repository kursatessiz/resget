-- CreateTable
CREATE TABLE "email_domains" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "fromLocalPart" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "dkimTokens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "spfStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "dkimStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "dmarcStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "dmarcPolicy" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_domains_domain_key" ON "email_domains"("domain");

-- CreateIndex
CREATE INDEX "email_domains_restaurantId_idx" ON "email_domains"("restaurantId");

-- CreateIndex
CREATE INDEX "email_suppressions_email_idx" ON "email_suppressions"("email");

-- CreateIndex
CREATE INDEX "email_suppressions_restaurantId_idx" ON "email_suppressions"("restaurantId");

-- AddForeignKey
ALTER TABLE "email_domains" ADD CONSTRAINT "email_domains_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One row per address and reason for each sender, and one global row per bounced address.
CREATE UNIQUE INDEX "email_suppressions_tenant_key" ON "email_suppressions"("restaurantId", "email", "reason") WHERE "restaurantId" IS NOT NULL;
CREATE UNIQUE INDEX "email_suppressions_global_key" ON "email_suppressions"("email", "reason") WHERE "restaurantId" IS NULL;
