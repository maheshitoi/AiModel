import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { DatasetsController } from './datasets.controller';
import { DatasetsService } from './datasets.service';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';

@Module({
  imports: [AiModule],
  controllers: [DatasetsController, TrainingController],
  providers: [DatasetsService, TrainingService],
})
export class TrainingModule {}
