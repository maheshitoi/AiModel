import { Module } from '@nestjs/common';
import { AiClientService } from './ai-client.service';
import { AiReplyService } from './ai-reply.service';
import { AiController } from './ai.controller';
import { ModelRegistryService } from './model-registry.service';

@Module({
  controllers: [AiController],
  providers: [AiClientService, ModelRegistryService, AiReplyService],
  // The WhatsApp webhook (Phase 11) calls AiReplyService.handleInbound for each customer message.
  exports: [AiReplyService],
})
export class AiModule {}
