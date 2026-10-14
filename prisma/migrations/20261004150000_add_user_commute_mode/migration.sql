-- CreateEnum
CREATE TYPE "CommuteMode" AS ENUM ('TRANSIT', 'DRIVING');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "commuteMode" "CommuteMode" NOT NULL DEFAULT 'TRANSIT';
