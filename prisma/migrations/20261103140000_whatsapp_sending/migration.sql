-- AlterEnum
ALTER TYPE "MessageStatus" ADD VALUE 'SENDING';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Message_status_nextAttemptAt_idx" ON "Message"("status", "nextAttemptAt");

