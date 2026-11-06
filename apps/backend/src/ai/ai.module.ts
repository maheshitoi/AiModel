import { Module } from '@nestjs/common';
import { AiClientService } from './ai-client.service';
import { AiReplyService } from './ai-reply.service';
import { AiController } from './ai.controller';
import { ModelRegistryService } from './model-registry.service';
import { ModelsController } from './models.controller';

@Module({
  controllers: [AiController, ModelsController],
  providers: [AiClientService, ModelRegistryService, AiReplyService],
  // The WhatsApp webhook (Phase 11) calls AiReplyService.handleInbound for each customer message.
  // TrainingModule (Phase 14) uses the client and the registry for datasets, jobs and new versions.
  exports: [AiReplyService, AiClientService, ModelRegistryService],
})
export class AiModule {}
