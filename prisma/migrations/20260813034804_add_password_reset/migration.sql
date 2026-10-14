-- AlterTable
ALTER TABLE "users" ADD COLUMN     "resetPasswordCode" TEXT,
ADD COLUMN     "resetPasswordExpiry" TIMESTAMP(3);
