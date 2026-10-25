-- DropIndex
DROP INDEX "shifts_jobId_idx";

-- CreateIndex
CREATE INDEX "shifts_userId_endTime_idx" ON "shifts"("userId", "endTime");

-- CreateIndex
CREATE INDEX "shifts_jobId_startTime_idx" ON "shifts"("jobId", "startTime");
