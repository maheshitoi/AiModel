import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export type ChartRange = 'daily' | 'weekly' | 'monthly';

// date_trunc unit, bucket step and number of buckets per range.
const RANGES: Record<ChartRange, { unit: string; step: string; buckets: number }> = {
  daily: { unit: 'day', step: '1 day', buckets: 30 },
  weekly: { unit: 'week', step: '1 week', buckets: 12 },
  monthly: { unit: 'month', step: '1 month', buckets: 12 },
};

export interface MessageChartPoint {
  bucket: string; // local date (YYYY-MM-DD) of the bucket start
  inbound: number;
  outbound: number;
  ai: number;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async overview() {
    const activeSince = new Date(Date.now() - 24 * 3_600_000);
    const [
      incoming,
      outgoing,
      conversations,
      activeConversations,
      aiReplies,
      failedMessages,
      usage,
      usageSucceeded,
      responseTime,
      recentConversations,
      recentErrors,
      activeModel,
    ] = await this.prisma.$transaction([
      this.prisma.message.count({ where: { direction: 'INBOUND' } }),
      this.prisma.message.count({ where: { direction: 'OUTBOUND' } }),
      this.prisma.conversation.count(),
      this.prisma.conversation.count({ where: { status: { not: 'CLOSED' }, lastMessageAt: { gte: activeSince } } }),
      this.prisma.message.count({ where: { source: 'AI' } }),
      this.prisma.message.count({ where: { status: 'FAILED' } }),
      this.prisma.aIUsage.count(),
      this.prisma.aIUsage.count({ where: { success: true } }),
      // Customer-perceived response time: inbound message → AI reply accepted by WhatsApp.
      this.prisma.$queryRaw<{ avg_ms: number | null }[]>`
        SELECT AVG(EXTRACT(EPOCH FROM (r."occurredAt" - i."occurredAt")) * 1000)::float8 AS avg_ms
        FROM "Message" r JOIN "Message" i ON r."aiReplyToId" = i.id
        WHERE r.status IN ('SENT', 'DELIVERED', 'READ')`,
      this.prisma.conversation.findMany({
        orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        take: 5,
        select: {
          id: true,
          customerWaId: true,
          customerName: true,
          lastMessagePreview: true,
          lastMessageAt: true,
          status: true,
          aiEnabled: true,
          unreadCount: true,
        },
      }),
      this.prisma.systemLog.findMany({
        where: { level: 'ERROR' },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, category: true, event: true, message: true, createdAt: true },
      }),
      this.prisma.modelVersion.findFirst({ where: { isActive: true }, include: { model: { select: { name: true } } } }),
    ]);

    return {
      totals: {
        incoming,
        outgoing,
        conversations,
        activeConversations,
        aiReplies,
        failedMessages,
        aiSuccessRate: usage > 0 ? usageSucceeded / usage : null,
        avgResponseTimeMs: responseTime[0]?.avg_ms ?? null,
      },
      recentConversations,
      recentErrors,
      activeModel: activeModel && {
        name: activeModel.model.name,
        version: activeModel.version,
        status: activeModel.status,
        parameterCount: activeModel.parameterCount,
        contextLength: activeModel.contextLength,
        activatedAt: activeModel.activatedAt,
      },
    };
  }

  /** Message counts per bucket in the configured timezone, including empty buckets. */
  async messagesChart(range: ChartRange): Promise<MessageChartPoint[]> {
    const { unit, step, buckets } = RANGES[range];
    const { timezone } = await this.settings.get('system');
    // "occurredAt" is stored as UTC without a zone; convert to local wall time for bucketing.
    const rows = await this.prisma.$queryRaw<{ bucket: Date; inbound: bigint; outbound: bigint; ai: bigint }[]>(Prisma.sql`
      WITH buckets AS (
        SELECT generate_series(
          date_trunc(${unit}, now() AT TIME ZONE ${timezone}) - (${buckets - 1} * ${step}::interval),
          date_trunc(${unit}, now() AT TIME ZONE ${timezone}),
          ${step}::interval
        ) AS bucket
      )
      SELECT b.bucket,
        COUNT(m.id) FILTER (WHERE m.direction = 'INBOUND') AS inbound,
        COUNT(m.id) FILTER (WHERE m.direction = 'OUTBOUND') AS outbound,
        COUNT(m.id) FILTER (WHERE m.source = 'AI') AS ai
      FROM buckets b
      LEFT JOIN "Message" m
        ON m."occurredAt" >= ((SELECT MIN(bucket) FROM buckets) AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC'
        AND date_trunc(${unit}, (m."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}) = b.bucket
      GROUP BY b.bucket
      ORDER BY b.bucket`);

    return rows.map((r) => ({
      bucket: r.bucket.toISOString().slice(0, 10),
      inbound: Number(r.inbound),
      outbound: Number(r.outbound),
      ai: Number(r.ai),
    }));
  }
}
