-- CreateTable
CREATE TABLE "share_grants" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "granteeId" TEXT,
    "inviteEmail" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "share_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "share_grants_ownerId_idx" ON "share_grants"("ownerId");

-- CreateIndex
CREATE INDEX "share_grants_granteeId_idx" ON "share_grants"("granteeId");

-- CreateIndex
CREATE INDEX "share_grants_inviteEmail_idx" ON "share_grants"("inviteEmail");

-- AddForeignKey
ALTER TABLE "share_grants" ADD CONSTRAINT "share_grants_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_grants" ADD CONSTRAINT "share_grants_granteeId_fkey" FOREIGN KEY ("granteeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
