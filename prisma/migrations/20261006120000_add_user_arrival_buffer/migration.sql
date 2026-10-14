-- How early the user wants to arrive at shifts (minutes; 0 = on time)
ALTER TABLE "users" ADD COLUMN "arrivalBufferMinutes" INTEGER NOT NULL DEFAULT 10;
