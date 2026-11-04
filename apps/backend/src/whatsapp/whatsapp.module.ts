import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CredentialCipher } from '../common/credential-cipher';
import { GraphApiClient } from './graph-api.client';
import { MessageSenderService } from './message-sender.service';
import { WhatsAppWebhookService } from './webhook.service';
import { WhatsAppAccountsController, WhatsAppWebhookController } from './whatsapp.controller';
import { WhatsAppAccountsService } from './whatsapp-accounts.service';

@Module({
  imports: [AiModule],
  controllers: [WhatsAppAccountsController, WhatsAppWebhookController],
  providers: [CredentialCipher, GraphApiClient, WhatsAppAccountsService, WhatsAppWebhookService, MessageSenderService],
  // The inbox queues staff replies and wakes the sender.
  exports: [MessageSenderService],
})
export class WhatsAppModule {}
