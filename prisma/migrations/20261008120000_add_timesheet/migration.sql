-- Timesheet: hours actually worked (clock in / clock out), and each job's pay period.
CREATE TYPE "PayFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY');

ALTER TABLE "jobs" ADD COLUMN "payFrequency" "PayFrequency" NOT NULL DEFAULT 'BIWEEKLY';
ALTER TABLE "jobs" ADD COLUMN "payday" TEXT;

CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "shiftId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "time_entries_userId_clockIn_idx" ON "time_entries"("userId", "clockIn");
CREATE INDEX "time_entries_jobId_clockIn_idx" ON "time_entries"("jobId", "clockIn");

ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
