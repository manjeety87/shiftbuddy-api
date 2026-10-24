-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN "isAutomatic" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN "features" JSONB NOT NULL DEFAULT '{}';

-- New accounts start with the timesheet and pay estimates off; accounts that
-- already exist keep them, so nothing they use disappears.
UPDATE "users" SET "features" = '{"timesheet": true, "pay": true}';
