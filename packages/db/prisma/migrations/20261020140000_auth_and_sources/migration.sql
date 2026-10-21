ALTER TABLE "User" ADD COLUMN "providerAccountId" TEXT;

CREATE UNIQUE INDEX "User_providerAccountId_key" ON "User"("providerAccountId");

ALTER TABLE "Message" ADD COLUMN "sources" JSONB;
