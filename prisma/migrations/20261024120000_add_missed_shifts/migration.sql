-- CreateEnum
CREATE TYPE "MissedReason" AS ENUM ('SICK', 'EMERGENCY', 'TRANSIT', 'CALLED_OFF', 'OTHER');

-- AlterTable
ALTER TABLE "shifts" ADD COLUMN "missedReason" "MissedReason",
ADD COLUMN "missedNote" TEXT;
