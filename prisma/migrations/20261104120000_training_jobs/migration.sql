-- AlterTable
ALTER TABLE "TrainingJob" ADD COLUMN     "device" TEXT,
ADD COLUMN     "runName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TrainingJob_runName_key" ON "TrainingJob"("runName");
