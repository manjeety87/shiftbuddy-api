-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "hourlyRate" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "taxDeductionPercent" DOUBLE PRECISION NOT NULL DEFAULT 13;
