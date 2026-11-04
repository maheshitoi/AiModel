import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AIDecision, Conversation, MessageSource, Prisma } from '@prisma/client';
import type { AuthUser, RequestMeta } from '../common/auth.types';
import { AuditService } from '../logs/audit.service';
import { SystemLogService } from '../logs/system-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { SettingValue } from '../settings/settings.dto';
import { SettingsService } from '../settings/settings.service';
import { AiChatMessage, AiClientService, AiGenerateResponse, AiServiceError } from './ai-client.service';
import { ModelRegistryService } from './model-registry.service';

const MAX_MESSAGE_CHARS = 4096; // the AI service's per-message limit
const URGENT_REASONS = new Set(['emergency', 'self_harm']);
const ACTIONS = { reply: 'REPLY', fallback: 'FALLBACK', handoff: 'HANDOFF' } as const;

/**
 * Whether a decision goes out without a person approving it. Every decision's text is safe to send
 * (docs/inference.md), but only an explicit opt-in sends model replies automatically. Fixed replies
 * to emergencies and self-harm go out at once unless that is switched off too: waiting for staff
 * could cost time someone doesn't have.
 */
export function shouldSendAutomatically(res: Pick<AiGenerateResponse, 'action' | 'reason'>, autoReplyEnabled: boolean, gen: SettingValue<'ai.generation'>): boolean {
  if (autoReplyEnabled) return true;
  return gen.sendSafetyRepliesImmediately && res.action === 'handoff' && URGENT_REASONS.has(res.reason);
}

/** Maps stored messages (oldest first) to the AI service's turns, ending with the customer. */
export function toChatHistory(rows: { direction: 'INBOUND' | 'OUTBOUND'; body: string | null }[]): AiChatMessage[] {
  const turns = rows
    .filter((r) => r.body?.trim())
    .map((r): AiChatMessage => ({ role: r.direction === 'INBOUND' ? 'customer' : 'assistant', text: r.body!.trim().slice(0, MAX_MESSAGE_CHARS) }));
  while (turns.length && turns[turns.length - 1].role !== 'customer') turns.pop();
  return turns;
}

@Injectable()
export class AiReplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClientService,
    private readonly registry: ModelRegistryService,
    private readonly settings: SettingsService,
    private readonly logs: SystemLogService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Decides how to answer an inbound customer message: once, however often it is called.
   * Returns null when the AI should not answer (not text, AI off for the conversation, a newer
   * message is waiting, or the AI service failed; failures are logged and the conversation flagged).
   */
  async handleInbound(messageId: string): Promise<AIDecision | null> {
    const inbound = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { aiDecision: true, conversation: { include: { whatsAppAccount: { select: { autoReplyEnabled: true } } } } },
    });
    if (!inbound) throw new NotFoundException('Message not found');
    if (inbound.aiDecision) return inbound.aiDecision;
    const convo = inbound.conversation;
    if (inbound.direction !== 'INBOUND' || inbound.type !== 'TEXT' || !inbound.body?.trim()) return null;
    if (!convo.aiEnabled || convo.status !== 'OPEN') return null;
    // Customers often send several short messages; answer the latest, with the others as context.
    // WhatsApp timestamps have 1 s resolution, so ties are broken by id (UUIDv7: insertion order).
    const newer = await this.prisma.message.count({
      where: {
        conversationId: convo.id,
        direction: 'INBOUND',
        OR: [{ occurredAt: { gt: inbound.occurredAt } }, { occurredAt: inbound.occurredAt, id: { gt: inbound.id } }],
      },
    });
    if (newer > 0) return null;

    const gen = await this.settings.get('ai.generation');
    const rows = await this.prisma.message.findMany({
      where: { conversationId: convo.id, type: 'TEXT', occurredAt: { lte: inbound.occurredAt }, status: { not: 'FAILED' } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: gen.historyMessages,
      select: { direction: true, body: true },
    });
    const messages = toChatHistory(rows.reverse());

    const started = performance.now();
    let res: AiGenerateResponse;
    try {
      res = await this.ai.generate({ request_id: inbound.id, messages, options: this.options(gen) });
    } catch (error) {
      await this.recordFailure(convo, inbound.id, error, Math.round(performance.now() - started));
      return null;
    }
    const latencyMs = Math.round(performance.now() - started);
    const modelVersionId = res.model ? await this.registry.versionFor(res.model) : null;
    if (res.model) void this.registry.ensureActiveLoaded();
    const send = shouldSendAutomatically(res, convo.whatsAppAccount.autoReplyEnabled, gen);

    try {
      const decision = await this.prisma.$transaction(async (tx) => {
        let decision = await tx.aIDecision.create({
          data: {
            conversationId: convo.id,
            inboundMessageId: inbound.id,
            modelVersionId,
            action: ACTIONS[res.action],
            reason: res.reason,
            detail: res.detail,
            text: res.text,
            modelText: res.model_text,
            confidence: res.confidence,
            handoffRequired: res.handoff_required,
            status: 'SUGGESTED',
          },
        });
        const outboundId = send ? await this.queueOutbound(tx, decision, res.text, 'AI', null) : null;
        if (outboundId) decision = await tx.aIDecision.findUniqueOrThrow({ where: { id: decision.id } });
        await tx.aIUsage.create({
          data: {
            conversationId: convo.id,
            messageId: outboundId,
            modelVersionId,
            inputTokens: res.usage.input_tokens,
            outputTokens: res.usage.output_tokens,
            latencyMs,
            success: true,
          },
        });
        if (res.handoff_required) {
          await tx.conversation.update({
            where: { id: convo.id },
            // A handoff means staff take over: the AI stops answering this conversation.
            data: { needsAttention: true, attentionReason: res.reason, ...(res.action === 'handoff' ? { status: 'HUMAN' } : {}) },
          });
        }
        return decision;
      });
      this.announce(decision);
      return decision;
    } catch (error) {
      // A concurrent call for the same message won the race; its decision stands.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.aIDecision.findUnique({ where: { inboundMessageId: inbound.id } });
      }
      throw error;
    }
  }

  /** Staff approve a suggestion, optionally edited. An edited reply is recorded as written by them. */
  async approve(decisionId: string, text: string | undefined, actor: AuthUser, meta: RequestMeta): Promise<AIDecision> {
    const approved = await this.prisma.$transaction(async (tx) => {
      const decision = await this.claim(tx, decisionId, 'QUEUED', actor);
      const conversation = await tx.conversation.findUniqueOrThrow({ where: { id: decision.conversationId } });
      if (conversation.status === 'CLOSED') throw new ConflictException('The conversation is closed');
      const edited = text !== undefined && text.trim() !== decision.text;
      await this.queueOutbound(tx, decision, edited ? text.trim() : decision.text, edited ? 'HUMAN' : 'AI', edited ? actor.id : null);
      await this.audit.record(
        { actorId: actor.id, action: 'ai_decision.approve', entityType: 'AIDecision', entityId: decision.id, after: { edited }, meta },
        tx,
      );
      return tx.aIDecision.findUniqueOrThrow({ where: { id: decision.id } });
    });
    this.announce(approved);
    return approved;
  }

  async dismiss(decisionId: string, actor: AuthUser, meta: RequestMeta): Promise<AIDecision> {
    const dismissed = await this.prisma.$transaction(async (tx) => {
      const decision = await this.claim(tx, decisionId, 'DISMISSED', actor);
      await this.audit.record({ actorId: actor.id, action: 'ai_decision.dismiss', entityType: 'AIDecision', entityId: decision.id, meta }, tx);
      return decision;
    });
    this.announce(dismissed);
    return dismissed;
  }

  /** Tells live inbox clients what changed (ids only). */
  private announce(decision: AIDecision): void {
    this.realtime.decision(decision.conversationId, decision.id);
    this.realtime.conversation(decision.conversationId);
    if (decision.outboundMessageId) this.realtime.message(decision.conversationId, decision.outboundMessageId);
  }

  /** Runs the AI on a made-up conversation (dashboard playground). Only usage is recorded. */
  async test(messages: AiChatMessage[]): Promise<AiGenerateResponse> {
    const gen = await this.settings.get('ai.generation');
    const started = performance.now();
    try {
      const res = await this.ai.generate({ messages, options: this.options(gen) });
      await this.prisma.aIUsage.create({
        data: {
          modelVersionId: res.model ? await this.registry.versionFor(res.model) : null,
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
          latencyMs: Math.round(performance.now() - started),
          success: true,
        },
      });
      return res;
    } catch (error) {
      await this.prisma.aIUsage.create({
        data: { inputTokens: 0, outputTokens: 0, latencyMs: Math.round(performance.now() - started), success: false, errorMessage: (error as Error).message },
      });
      throw error;
    }
  }

  private options(gen: SettingValue<'ai.generation'>) {
    return {
      max_new_tokens: gen.maxNewTokens,
      temperature: gen.temperature,
      top_k: gen.topK,
      top_p: gen.topP,
      min_confidence: gen.minConfidence,
      fallback_reply: gen.fallbackReply.trim() || undefined,
    };
  }

  /** Moves a SUGGESTED decision on, atomically: two people can't both approve it. */
  private async claim(tx: Prisma.TransactionClient, id: string, status: 'QUEUED' | 'DISMISSED', actor: AuthUser): Promise<AIDecision> {
    const { count } = await tx.aIDecision.updateMany({
      where: { id, status: 'SUGGESTED' },
      data: { status, reviewedById: actor.id, reviewedAt: new Date() },
    });
    if (count === 0) {
      const exists = await tx.aIDecision.count({ where: { id } });
      throw exists ? new ConflictException('This suggestion was already handled') : new NotFoundException('Suggestion not found');
    }
    return tx.aIDecision.findUniqueOrThrow({ where: { id } });
  }

  /** Creates the outbound message for the WhatsApp sender (Phase 11) to deliver. */
  private async queueOutbound(tx: Prisma.TransactionClient, decision: AIDecision, text: string, source: MessageSource, sentById: string | null): Promise<string> {
    const now = new Date();
    const message = await tx.message.create({
      data: {
        conversationId: decision.conversationId,
        direction: 'OUTBOUND',
        type: 'TEXT',
        source,
        body: text,
        status: 'QUEUED',
        aiReplyToId: decision.inboundMessageId, // unique: at most one reply per inbound message
        sentById,
        occurredAt: now,
      },
    });
    await tx.messageStatusHistory.create({ data: { messageId: message.id, status: 'QUEUED', occurredAt: now } });
    await tx.conversation.update({ where: { id: decision.conversationId }, data: { lastMessageAt: now, lastMessagePreview: text.slice(0, 120) } });
    await tx.aIDecision.update({ where: { id: decision.id }, data: { status: 'QUEUED', outboundMessageId: message.id } });
    return message.id;
  }

  private async recordFailure(convo: Conversation, messageId: string, error: unknown, latencyMs: number): Promise<void> {
    const kind = error instanceof AiServiceError ? error.kind : 'internal';
    const message = (error as Error).message;
    await this.prisma.aIUsage.create({
      data: { conversationId: convo.id, inputTokens: 0, outputTokens: 0, latencyMs, success: false, errorMessage: message },
    });
    await this.prisma.conversation.update({ where: { id: convo.id }, data: { needsAttention: true, attentionReason: 'ai_unavailable' } });
    await this.logs.warn('AI', 'ai.request_failed', message, { kind }, { conversationId: convo.id, messageId });
    this.realtime.conversation(convo.id);
  }
}
