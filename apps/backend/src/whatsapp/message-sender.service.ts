import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Message } from '@prisma/client';
import { SystemLogService } from '../logs/system-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { GraphApiClient, GraphApiError } from './graph-api.client';
import { WhatsAppAccountsService } from './whatsapp-accounts.service';

export const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000;
const BATCH = 20;
const STUCK_AFTER_MS = 5 * 60_000;
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60_000;

/** 30 s, 1 min, 2 min, 4 min… after each temporary failure. */
export const backoffMs = (retryCount: number) => BASE_BACKOFF_MS * 2 ** retryCount;

/**
 * Delivers QUEUED outbound messages through the Cloud API.
 *
 * Each message is claimed (QUEUED → SENDING) by a conditional update, so overlapping runs never send
 * it twice. If the process dies mid-send, the message may or may not have reached WhatsApp, so it
 * becomes FAILED ("send_interrupted") for staff to check, rather than risk a duplicate.
 */
@Injectable()
export class MessageSenderService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MessageSenderService.name);
  private timer?: NodeJS.Timeout;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphApiClient,
    private readonly accounts: WhatsAppAccountsService,
    private readonly logs: SystemLogService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    const interval = Number(this.config.get('WHATSAPP_SENDER_INTERVAL_MS') ?? 2000);
    if (interval > 0) this.timer = setInterval(() => void this.kick(), interval).unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Runs a sending pass now (or right after the one in progress). */
  kick(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.processDue().catch((e: Error) => this.logger.error(`Sending pass failed: ${e.message}`));
      } while (this.again);
    })().finally(() => (this.running = null));
    return this.running;
  }

  async processDue(now = new Date()): Promise<number> {
    await this.failStuck(now);
    let sent = 0;
    for (;;) {
      const due = await this.prisma.message.findMany({
        where: { direction: 'OUTBOUND', status: 'QUEUED', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        orderBy: { occurredAt: 'asc' },
        take: BATCH,
      });
      if (due.length === 0) return sent;
      for (const message of due) {
        const { count } = await this.prisma.message.updateMany({ where: { id: message.id, status: 'QUEUED' }, data: { status: 'SENDING' } });
        if (count === 1) {
          await this.send(message, now);
          sent++;
        }
      }
      if (due.length < BATCH) return sent;
    }
  }

  private async send(message: Message, now: Date): Promise<void> {
    const conversation = await this.prisma.conversation.findUniqueOrThrow({ where: { id: message.conversationId }, include: { whatsAppAccount: true } });
    const account = conversation.whatsAppAccount;
    if (account.status === 'DISABLED') return this.fail(message, 'account_disabled', 'The WhatsApp account is disabled');
    if (!conversation.lastInboundAt || now.getTime() - conversation.lastInboundAt.getTime() > CUSTOMER_SERVICE_WINDOW_MS) {
      return this.fail(
        message,
        'outside_24h_window',
        "WhatsApp only allows free-form replies within 24 hours of the customer's last message. A template message is needed.",
      );
    }
    if (!message.body?.trim()) return this.fail(message, 'empty_body', 'The message has no text');

    try {
      const { accessToken } = this.accounts.credentials(account);
      const waMessageId = await this.graph.sendText(account.phoneNumberId, accessToken, conversation.customerWaId, message.body);
      await this.prisma.$transaction([
        this.prisma.message.update({ where: { id: message.id }, data: { status: 'SENT', waMessageId, errorCode: null, errorMessage: null, nextAttemptAt: null } }),
        this.prisma.messageStatusHistory.createMany({ data: [{ messageId: message.id, status: 'SENT', occurredAt: new Date() }], skipDuplicates: true }),
      ]);
    } catch (error) {
      const graphError = error instanceof GraphApiError ? error : null;
      const code = graphError?.code ?? 'internal';
      const text = graphError?.message ?? 'Could not send the message';
      if (graphError?.authFailed) {
        await this.prisma.whatsAppAccount.update({ where: { id: account.id }, data: { status: 'ERROR' } });
        await this.logs.error('WHATSAPP', 'whatsapp.auth_failed', `WhatsApp rejected the access token for ${account.displayName}`, { code, accountId: account.id });
      }
      if (graphError?.retryable && message.retryCount + 1 < MAX_ATTEMPTS) {
        await this.prisma.message.update({
          where: { id: message.id },
          data: { status: 'QUEUED', retryCount: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + backoffMs(message.retryCount)), errorCode: code, errorMessage: text },
        });
        return;
      }
      return this.fail(message, code, text);
    }
  }

  private async fail(message: Message, code: string, text: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.message.update({ where: { id: message.id }, data: { status: 'FAILED', errorCode: code, errorMessage: text, nextAttemptAt: null } }),
      this.prisma.messageStatusHistory.createMany({ data: [{ messageId: message.id, status: 'FAILED', errorCode: code, errorMessage: text, occurredAt: new Date() }], skipDuplicates: true }),
      this.prisma.conversation.update({ where: { id: message.conversationId }, data: { needsAttention: true, attentionReason: 'delivery_failed' } }),
    ]);
    await this.logs.warn('WHATSAPP', 'whatsapp.send_failed', text, { code, retryCount: message.retryCount }, { conversationId: message.conversationId, messageId: message.id });
  }

  private async failStuck(now: Date): Promise<void> {
    const stuck = await this.prisma.message.findMany({
      where: { status: 'SENDING', updatedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
      select: { id: true, conversationId: true, retryCount: true },
    });
    for (const m of stuck) {
      await this.fail(m as Message, 'send_interrupted', 'Sending was interrupted. Check WhatsApp before resending: it may already have been delivered.');
    }
  }
}
