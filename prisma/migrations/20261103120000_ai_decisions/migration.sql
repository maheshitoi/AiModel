-- CreateEnum
CREATE TYPE "AIDecisionAction" AS ENUM ('REPLY', 'FALLBACK', 'HANDOFF');

-- CreateEnum
CREATE TYPE "AIDecisionStatus" AS ENUM ('SUGGESTED', 'QUEUED', 'DISMISSED');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "attentionReason" TEXT,
ADD COLUMN     "needsAttention" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AIDecision" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "inboundMessageId" UUID NOT NULL,
    "modelVersionId" UUID,
    "action" "AIDecisionAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "text" TEXT NOT NULL,
    "modelText" TEXT,
    "confidence" DOUBLE PRECISION,
    "handoffRequired" BOOLEAN NOT NULL,
    "status" "AIDecisionStatus" NOT NULL,
    "outboundMessageId" UUID,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AIDecision_inboundMessageId_key" ON "AIDecision"("inboundMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "AIDecision_outboundMessageId_key" ON "AIDecision"("outboundMessageId");

-- CreateIndex
CREATE INDEX "AIDecision_conversationId_createdAt_idx" ON "AIDecision"("conversationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AIDecision_status_createdAt_idx" ON "AIDecision"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Conversation_needsAttention_lastMessageAt_idx" ON "Conversation"("needsAttention", "lastMessageAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ModelVersion_checkpointPath_key" ON "ModelVersion"("checkpointPath");

-- AddForeignKey
ALTER TABLE "AIDecision" ADD CONSTRAINT "AIDecision_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIDecision" ADD CONSTRAINT "AIDecision_inboundMessageId_fkey" FOREIGN KEY ("inboundMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIDecision" ADD CONSTRAINT "AIDecision_outboundMessageId_fkey" FOREIGN KEY ("outboundMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIDecision" ADD CONSTRAINT "AIDecision_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIDecision" ADD CONSTRAINT "AIDecision_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

