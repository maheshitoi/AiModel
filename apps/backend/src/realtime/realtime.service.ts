import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

/** Inbox clients join this room; only users with conversations:read can. */
export const INBOX_ROOM = 'inbox';

export type InboxEvent =
  | { type: 'conversation.changed'; conversationId: string }
  | { type: 'message.changed'; conversationId: string; messageId: string }
  | { type: 'decision.changed'; conversationId: string; decisionId: string };

/**
 * Pushes "something changed" signals to the live inbox. Events carry ids only, never message text:
 * clients refetch through the REST API, where permissions are enforced.
 */
@Injectable()
export class RealtimeService {
  private server: Server | null = null;

  attach(server: Server): void {
    this.server = server;
  }

  emit(event: InboxEvent): void {
    this.server?.to(INBOX_ROOM).emit('inbox', event);
  }

  conversation(conversationId: string): void {
    this.emit({ type: 'conversation.changed', conversationId });
  }

  message(conversationId: string, messageId: string): void {
    this.emit({ type: 'message.changed', conversationId, messageId });
  }

  decision(conversationId: string, decisionId: string): void {
    this.emit({ type: 'decision.changed', conversationId, decisionId });
  }
}
