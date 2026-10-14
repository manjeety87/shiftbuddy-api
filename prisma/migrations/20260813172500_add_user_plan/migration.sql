-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PRO', 'TESTER');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "plan" "Plan" NOT NULL DEFAULT 'FREE';
