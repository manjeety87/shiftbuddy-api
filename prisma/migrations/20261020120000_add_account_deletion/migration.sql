-- Account deletion with a grace period: the request date, and an index for the daily purge
ALTER TABLE "users" ADD COLUMN "deletionRequestedAt" TIMESTAMP(3);

CREATE INDEX "users_deletionRequestedAt_idx" ON "users"("deletionRequestedAt");
