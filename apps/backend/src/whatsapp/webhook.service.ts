import { Injectable, Logger } from '@nestjs/common';
import { MessageStatus, MessageType, Prisma, WhatsAppAccount } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AiReplyService } from '../ai/ai-reply.service';
import { SystemLogService } from '../logs/system-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { MessageSenderService } from './message-sender.service';
import type { ChangeValue, InboundMessage, StatusUpdate, WebhookPayload } from './webhook.types';
import { WhatsAppAccountsService } from './whatsapp-accounts.service';

const MEDIA_TYPES: Record<string, MessageType> = { image: 'IMAGE', document: 'DOCUMENT', audio: 'AUDIO', video: 'VIDEO', sticker: 'STICKER' };
const STATUS_MAP: Record<string, MessageStatus> = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };
const RANK: Record<MessageStatus, number> = { RECEIVED: 0, QUEUED: 0, SENDING: 1, SENT: 2, DELIVERED: 3, READ: 4, FAILED: 5 };

export interface ParsedMessage {
  type: MessageType;
  body: string | null;
  mediaId?: string;
  mediaMimeType?: string;
  mediaCaption?: string;
  preview: string;
}

/** Maps one inbound WhatsApp message to our columns. Only TEXT messages are answered by the AI. */
export function parseInbound(m: InboundMessage): ParsedMessage {
  if (m.type === 'text') return { type: 'TEXT', body: m.text?.body ?? '', preview: m.text?.body ?? '' };
  const media = MEDIA_TYPES[m.type];
  if (media) {
    const part = m[m.type as 'image'] ?? {};
    const caption = part.caption ?? part.filename;
    return { type: media, body: caption ?? null, mediaId: part.id, mediaMimeType: part.mime_type, mediaCaption: part.caption, preview: caption ?? `[${m.type}]` };
  }
  switch (m.type) {
    case 'location': {
      const l = m.location ?? {};
      const text = [l.name, l.address].filter(Boolean).join(', ') || `${l.latitude}, ${l.longitude}`;
      return { type: 'LOCATION', body: text, preview: `[location] ${text}` };
    }
    case 'contacts':
      return { type: 'CONTACTS', body: m.contacts?.map((c) => c.name?.formatted_name).filter(Boolean).join(', ') || null, preview: '[contact]' };
    case 'button':
      return { type: 'INTERACTIVE', body: m.button?.text ?? null, preview: m.button?.text ?? '[button]' };
    case 'interactive': {
      const title = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
      return { type: 'INTERACTIVE', body: title, preview: title ?? '[interactive]' };
    }
    case 'reaction':
      return { type: 'REACTION', body: m.reaction?.emoji ?? null, preview: `[reaction] ${m.reaction?.emoji ?? ''}`.trim() };
    default:
      return { type: 'UNSUPPORTED', body: null, preview: `[${m.type}]` };
  }
}

/** Constant-time check of Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body). */
export function signatureMatches(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function phoneNumberIds(payload: WebhookPayload): string[] {
  const ids = (payload.entry ?? []).flatMap((e) => (e.changes ?? []).map((c) => c.value?.metadata?.phone_number_id));
  return [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
}

@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: WhatsAppAccountsService,
    private readonly replies: AiReplyService,
    private readonly sender: MessageSenderService,
    private readonly logs: SystemLogService,
  ) {}

  /** GET verification: Meta echoes the verify token configured in the app dashboard. */
  async verifyToken(token: string): Promise<boolean> {
    const accounts = await this.prisma.whatsAppAccount.findMany({ where: { status: { not: 'DISABLED' } } });
    const given = Buffer.from(token);
    return accounts.some((a) => {
      let expected: Buffer;
      try {
        expected = Buffer.from(this.accounts.credentials(a).verifyToken);
      } catch {
        // One unreadable account (e.g. after a key change) must not break verification for the rest.
        this.logger.error(`Cannot decrypt the credentials of WhatsApp account ${a.id}`);
        return false;
      }
      return expected.length === given.length && timingSafeEqual(expected, given);
    });
  }

  /**
   * Returns the accounts the payload is for, or null if the signature doesn't match every one of
   * them (each account has its own app secret).
   */
  async authenticate(payload: WebhookPayload, rawBody: Buffer, signature: string | undefined): Promise<WhatsAppAccount[] | null> {
    const ids = phoneNumberIds(payload);
    const accounts = await this.prisma.whatsAppAccount.findMany({ where: { phoneNumberId: { in: ids } } });
    if (accounts.length === 0) return [];
    return accounts.every((a) => signatureMatches(rawBody, signature, this.accounts.credentials(a).appSecret)) ? accounts : null;
  }

  /** Stores messages and statuses. AI replies run after the webhook has been acknowledged. */
  async process(payload: WebhookPayload, accounts: WhatsAppAccount[]): Promise<{ messages: number; statuses: number }> {
    const byPhoneId = new Map(accounts.map((a) => [a.phoneNumberId, a]));
    const toAnswer: string[] = [];
    let messages = 0;
    let statuses = 0;
    for (const change of (payload.entry ?? []).flatMap((e) => e.changes ?? [])) {
      const value = change.value;
      const account = byPhoneId.get(value?.metadata?.phone_number_id ?? '');
      if (change.field !== 'messages' || !value || !account || account.status === 'DISABLED') continue;
      await this.prisma.whatsAppAccount.update({ where: { id: account.id }, data: { lastWebhookAt: new Date() } });
      for (const m of value.messages ?? []) {
        const stored = await this.storeInbound(account, value, m);
        if (stored) {
          messages++;
          if (stored.type === 'TEXT') toAnswer.push(stored.id);
        }
      }
      for (const s of value.statuses ?? []) statuses += (await this.applyStatus(s)) ? 1 : 0;
    }
    if (toAnswer.length) setImmediate(() => void this.answer(toAnswer));
    return { messages, statuses };
  }

  private async answer(messageIds: string[]): Promise<void> {
    for (const id of messageIds) {
      try {
        const decision = await this.replies.handleInbound(id);
        if (decision?.status === 'QUEUED') void this.sender.kick();
      } catch (error) {
        this.logger.error(`AI handling failed for message ${id}: ${(error as Error).message}`);
        await this.logs.error('AI', 'ai.handle_inbound_failed', (error as Error).message, {}, { messageId: id });
      }
    }
  }

  /** Returns the stored message, or null for a redelivery of a message we already have. */
  private async storeInbound(account: WhatsAppAccount, value: ChangeValue, m: InboundMessage) {
    if (!m?.id || !m.from) return null;
    if (await this.prisma.message.findUnique({ where: { waMessageId: m.id }, select: { id: true } })) return null;
    const parsed = parseInbound(m);
    const occurredAt = Number(m.timestamp) > 0 ? new Date(Number(m.timestamp) * 1000) : new Date();
    const name = value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const convo = await tx.conversation.upsert({
          where: { whatsAppAccountId_customerWaId: { whatsAppAccountId: account.id, customerWaId: m.from } },
          create: { whatsAppAccountId: account.id, customerWaId: m.from, customerName: name },
          update: {},
        });
        const message = await tx.message.create({
          data: {
            conversationId: convo.id,
            direction: 'INBOUND',
            source: 'CUSTOMER',
            type: parsed.type,
            body: parsed.body,
            mediaId: parsed.mediaId,
            mediaMimeType: parsed.mediaMimeType,
            mediaCaption: parsed.mediaCaption,
            waMessageId: m.id,
            status: 'RECEIVED',
            occurredAt,
          },
        });
        const newest = !convo.lastMessageAt || occurredAt >= convo.lastMessageAt;
        await tx.conversation.update({
          where: { id: convo.id },
          data: {
            unreadCount: { increment: 1 },
            ...(name && { customerName: name }),
            ...(newest && { lastMessageAt: occurredAt, lastMessagePreview: parsed.preview.slice(0, 120) }),
            ...((!convo.lastInboundAt || occurredAt > convo.lastInboundAt) && { lastInboundAt: occurredAt }),
            ...(convo.status === 'CLOSED' && { status: 'OPEN' }), // a new message reopens it
          },
        });
        return message;
      });
    } catch (error) {
      // Two deliveries of the same webhook processed at the same moment.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
      throw error;
    }
  }

  /** Returns false for statuses of messages this app didn't send. */
  private async applyStatus(s: StatusUpdate): Promise<boolean> {
    const status = STATUS_MAP[s.status];
    if (!s?.id || !status) return false;
    const message = await this.prisma.message.findUnique({ where: { waMessageId: s.id } });
    if (!message) return false;
    const err = s.errors?.[0];
    const errorCode = err?.code !== undefined ? String(err.code) : undefined;
    const errorMessage = err ? (err.error_data?.details ?? err.message ?? err.title)?.slice(0, 500) : undefined;
    const occurredAt = Number(s.timestamp) > 0 ? new Date(Number(s.timestamp) * 1000) : new Date();

    await this.prisma.messageStatusHistory.createMany({ data: [{ messageId: message.id, status, errorCode, errorMessage, occurredAt }], skipDuplicates: true });
    // Webhooks can arrive out of order: never move back from "read" to "delivered".
    const advances = status === 'FAILED' ? !['DELIVERED', 'READ'].includes(message.status) : RANK[status] > RANK[message.status];
    if (advances) {
      await this.prisma.message.update({
        where: { id: message.id },
        data: { status, ...(status === 'FAILED' && { errorCode, errorMessage }) },
      });
    }
    if (status === 'FAILED' && advances) {
      await this.prisma.conversation.update({ where: { id: message.conversationId }, data: { needsAttention: true, attentionReason: 'delivery_failed' } });
      await this.logs.warn('WHATSAPP', 'whatsapp.delivery_failed', `WhatsApp could not deliver a message (code ${errorCode ?? 'unknown'})`, { errorCode }, {
        conversationId: message.conversationId,
        messageId: message.id,
      });
    }
    return true;
  }
}
