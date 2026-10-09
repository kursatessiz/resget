-- CreateTable
CREATE TABLE "session_handoffs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "session_handoffs_codeHash_key" ON "session_handoffs"("codeHash");

-- CreateIndex
CREATE INDEX "session_handoffs_expiresAt_idx" ON "session_handoffs"("expiresAt");

-- AddForeignKey
ALTER TABLE "session_handoffs" ADD CONSTRAINT "session_handoffs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

