-- Postgres doesn't index foreign keys by itself. Nearly every shift query is
-- "this user's shifts in a time range"; jobs are listed per user; deleting a job
-- looks up its shifts.
CREATE INDEX "shifts_userId_startTime_idx" ON "shifts"("userId", "startTime");
CREATE INDEX "shifts_jobId_idx" ON "shifts"("jobId");
CREATE INDEX "jobs_userId_idx" ON "jobs"("userId");
