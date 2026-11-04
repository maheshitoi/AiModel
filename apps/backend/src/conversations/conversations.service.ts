import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser, RequestMeta } from '../common/auth.types';
import { Paginated } from '../common/pagination';
import { AuditService } from '../logs/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CUSTOMER_SERVICE_WINDOW_MS, MessageSenderService } from '../whatsapp/message-sender.service';
import { ConversationQueryDto, MessageQueryDto, SendMessageDto, UpdateConversationDto } from './conversations.dto';

/** Free-form replies are allowed until 24 h after the customer's last message (WhatsApp rule). */
export function replyWindowEndsAt(lastInboundAt: Date | null): Date | null {
  return lastInboundAt ? new Date(lastInboundAt.getTime() + CUSTOMER_SERVICE_WINDOW_MS) : null;
}

export function filterWhere(filter: ConversationQueryDto['filter']): Prisma.ConversationWhereInput {
  switch (filter) {
    case 'attention':
      return { needsAttention: true, status: { not: 'CLOSED' } };
    case 'open':
      return { status: 'OPEN' };
    case 'human':
      return { status: 'HUMAN' };
    case 'closed':
      return { status: 'CLOSED' };
    default:
      return { status: { not: 'CLOSED' } };
  }
}

const LIST_SELECT = {
  id: true,
  whatsAppAccountId: true,
  customerWaId: true,
  customerName: true,
  status: true,
  aiEnabled: true,
  unreadCount: true,
  needsAttention: true,
  attentionReason: true,
  lastMessageAt: true,
  lastMessagePreview: true,
  lastInboundAt: true,
  assignedTo: { select: { id: true, name: true } },
  _count: { select: { aiDecisions: { where: { status: 'SUGGESTED' } } } },
} satisfies Prisma.ConversationSelect;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly sender: MessageSenderService,
  ) {}

  async list(q: ConversationQueryDto) {
    const digits = q.search?.replace(/\D/g, '');
    const where: Prisma.ConversationWhereInput = {
      ...filterWhere(q.filter),
      ...(q.accountId && { whatsAppAccountId: q.accountId }),
      ...(q.search && {
        OR: [{ customerName: { contains: q.search, mode: 'insensitive' } }, ...(digits ? [{ customerWaId: { contains: digits } }] : [])],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        select: LIST_SELECT,
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.conversation.count({ where }),
    ]);
    const items = rows.map(({ _count, ...c }) => ({ ...c, pendingSuggestions: _count.aiDecisions, replyWindowEndsAt: replyWindowEndsAt(c.lastInboundAt) }));
    return new Paginated(items, total, q);
  }

  async get(id: string) {
    const c = await this.prisma.conversation.findUnique({
      where: { id },
      select: {
        ...LIST_SELECT,
        createdAt: true,
        whatsAppAccount: { select: { id: true, displayName: true, phoneNumber: true, autoReplyEnabled: true, status: true } },
        aiDecisions: { where: { status: 'SUGGESTED' }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!c) throw new NotFoundException('Conversation not found');
    const { _count, aiDecisions, ...rest } = c;
    return { ...rest, pendingSuggestions: _count.aiDecisions, pendingDecision: aiDecisions[0] ?? null, replyWindowEndsAt: replyWindowEndsAt(c.lastInboundAt) };
  }

  /** Newest first; pass `before` (the oldest loaded occurredAt) to page back. */
  async messages(id: string, q: MessageQueryDto) {
    await this.ensureExists(id);
    const rows = await this.prisma.message.findMany({
      where: { conversationId: id, ...(q.before && { occurredAt: { lt: q.before } }) },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      select: {
        id: true,
        direction: true,
        type: true,
        source: true,
        body: true,
        mediaCaption: true,
        mediaMimeType: true,
        status: true,
        errorCode: true,
        errorMessage: true,
        retryCount: true,
        occurredAt: true,
        sentBy: { select: { id: true, name: true } },
        aiDecision: { select: { id: true, action: true, reason: true, status: true, confidence: true } },
      },
    });
    return { items: rows.slice(0, q.limit), hasMore: rows.length > q.limit };
  }

  async markRead(id: string): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
    this.realtime.conversation(id);
  }

  async update(id: string, dto: UpdateConversationDto, actor: AuthUser, meta: RequestMeta) {
    const before = await this.prisma.conversation.findUnique({
      where: { id },
      select: { status: true, aiEnabled: true, assignedToId: true, needsAttention: true, attentionReason: true },
    });
    if (!before) throw new NotFoundException('Conversation not found');
    if (dto.assignedToId) {
      const assignee = await this.prisma.user.findUnique({ where: { id: dto.assignedToId }, select: { isActive: true } });
      if (!assignee?.isActive) throw new BadRequestException('assignedToId must be an active user');
    }
    const data: Prisma.ConversationUncheckedUpdateInput = {
      status: dto.status,
      aiEnabled: dto.aiEnabled,
      assignedToId: dto.assignedToId,
      ...(dto.needsAttention === false && { needsAttention: false, attentionReason: null }),
    };
    await this.prisma.$transaction(async (tx) => {
      const after = await tx.conversation.update({
        where: { id },
        data,
        select: { status: true, aiEnabled: true, assignedToId: true, needsAttention: true, attentionReason: true },
      });
      await this.audit.record({ actorId: actor.id, action: 'conversation.update', entityType: 'Conversation', entityId: id, before, after, meta }, tx);
    });
    this.realtime.conversation(id);
    return this.get(id);
  }

  /**
   * Queues a staff reply for the sender. Pending AI suggestions for the conversation are dismissed:
   * staff have answered instead.
   */
  async send(id: string, dto: SendMessageDto, actor: AuthUser, meta: RequestMeta) {
    const convo = await this.prisma.conversation.findUnique({ where: { id }, include: { whatsAppAccount: { select: { status: true } } } });
    if (!convo) throw new NotFoundException('Conversation not found');
    if (convo.whatsAppAccount.status === 'DISABLED') throw new ConflictException('This WhatsApp number is disabled');
    const windowEnd = replyWindowEndsAt(convo.lastInboundAt);
    if (!windowEnd || windowEnd <= new Date()) {
      throw new ConflictException(
        "The customer's last message was more than 24 hours ago. WhatsApp only allows a template message now, which is not supported yet.",
      );
    }
    const now = new Date();
    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { conversationId: id, direction: 'OUTBOUND', type: 'TEXT', source: 'HUMAN', body: dto.text, status: 'QUEUED', sentById: actor.id, occurredAt: now },
        select: { id: true },
      });
      await tx.messageStatusHistory.create({ data: { messageId: created.id, status: 'QUEUED', occurredAt: now } });
      await tx.aIDecision.updateMany({
        where: { conversationId: id, status: 'SUGGESTED' },
        data: { status: 'DISMISSED', reviewedById: actor.id, reviewedAt: now },
      });
      await tx.conversation.update({ where: { id }, data: { lastMessageAt: now, lastMessagePreview: dto.text.slice(0, 120), unreadCount: 0 } });
      // The reply text is customer correspondence: the audit entry records that a reply was sent, not what it said.
      await this.audit.record({ actorId: actor.id, action: 'conversation.reply', entityType: 'Message', entityId: created.id, after: { conversationId: id }, meta }, tx);
      return created;
    });
    this.realtime.message(id, message.id);
    this.realtime.conversation(id);
    void this.sender.kick();
    return message;
  }

  /** Re-queues a FAILED outbound message (staff confirmed it should be sent again). */
  async retry(id: string, messageId: string, actor: AuthUser, meta: RequestMeta) {
    const message = await this.prisma.message.findFirst({ where: { id: messageId, conversationId: id } });
    if (!message) throw new NotFoundException('Message not found');
    if (message.direction !== 'OUTBOUND' || message.status !== 'FAILED') throw new ConflictException('Only failed outgoing messages can be retried');
    const { count } = await this.prisma.message.updateMany({
      where: { id: messageId, status: 'FAILED' },
      data: { status: 'QUEUED', retryCount: 0, nextAttemptAt: null, errorCode: null, errorMessage: null },
    });
    if (count === 0) throw new ConflictException('The message was already retried');
    await this.audit.record({ actorId: actor.id, action: 'message.retry', entityType: 'Message', entityId: messageId, before: { errorCode: message.errorCode }, meta });
    this.realtime.message(id, messageId);
    void this.sender.kick();
    return { id: messageId, status: 'QUEUED' as const };
  }

  private async ensureExists(id: string): Promise<void> {
    if (!(await this.prisma.conversation.count({ where: { id } }))) throw new NotFoundException('Conversation not found');
  }
}
