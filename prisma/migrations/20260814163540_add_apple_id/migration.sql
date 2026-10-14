/*
  Warnings:

  - A unique constraint covering the columns `[appleId]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "appleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_appleId_key" ON "users"("appleId");
