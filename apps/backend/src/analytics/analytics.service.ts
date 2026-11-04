import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Paginated } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { MessageSearchDto } from './analytics.dto';

export interface UsageDay {
  day: string; // local calendar date, YYYY-MM-DD
  requests: number;
  failures: number;
  avgLatencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
}

const n = (v: bigint | number | null) => (v === null ? 0 : Number(v));

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** AI usage, decision outcomes and delivery results for the last `days` local days, including today. */
  async usage(days: number) {
    const { timezone } = await this.settings.get('system');
    // Timestamps are stored as UTC without a zone: local midnight → UTC, the same way the dashboard chart buckets.
    const [{ since }] = await this.prisma.$queryRaw<{ since: Date }[]>(Prisma.sql`
      SELECT ((date_trunc('day', now() AT TIME ZONE ${timezone}) - ${days - 1} * interval '1 day') AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC' AS since`);

    const [ai, series, actions, reasons, outcomes, directions, outboundStatuses, failureCodes, byVersion] = await Promise.all([
      this.prisma.$queryRaw<{ requests: bigint; succeeded: bigint; input: bigint | null; output: bigint | null; avg: number | null; p95: number | null }[]>(Prisma.sql`
        SELECT COUNT(*) AS requests,
          COUNT(*) FILTER (WHERE success) AS succeeded,
          SUM("inputTokens") AS input,
          SUM("outputTokens") AS output,
          AVG("latencyMs") FILTER (WHERE success)::float8 AS avg,
          (percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") FILTER (WHERE success))::float8 AS p95
        FROM "AIUsage" WHERE "createdAt" >= ${since}`),
      this.prisma.$queryRaw<{ day: Date; requests: bigint; failures: bigint; avg: number | null; input: bigint | null; output: bigint | null }[]>(Prisma.sql`
        WITH days AS (
          SELECT generate_series(date_trunc('day', now() AT TIME ZONE ${timezone}) - ${days - 1} * interval '1 day',
                                 date_trunc('day', now() AT TIME ZONE ${timezone}), interval '1 day') AS day
        )
        SELECT d.day,
          COUNT(u.id) AS requests,
          COUNT(u.id) FILTER (WHERE NOT u.success) AS failures,
          AVG(u."latencyMs") FILTER (WHERE u.success)::float8 AS avg,
          SUM(u."inputTokens") AS input,
          SUM(u."outputTokens") AS output
        FROM days d
        LEFT JOIN "AIUsage" u ON u."createdAt" >= ${since}
          AND date_trunc('day', (u."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}) = d.day
        GROUP BY d.day ORDER BY d.day`),
      this.prisma.aIDecision.groupBy({ by: ['action'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.aIDecision.groupBy({
        by: ['reason'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { reason: 'desc' } },
      }),
      // How suggestions ended: sent automatically, approved as written, edited by staff, dismissed, or still waiting.
      this.prisma.$queryRaw<{ outcome: string; count: bigint }[]>(Prisma.sql`
        SELECT CASE
            WHEN d.status = 'SUGGESTED' THEN 'pending'
            WHEN d.status = 'DISMISSED' THEN 'dismissed'
            WHEN d."reviewedById" IS NULL THEN 'automatic'
            WHEN m.source = 'HUMAN' THEN 'edited'
            ELSE 'approved' END AS outcome,
          COUNT(*) AS count
        FROM "AIDecision" d LEFT JOIN "Message" m ON m.id = d."outboundMessageId"
        WHERE d."createdAt" >= ${since}
        GROUP BY 1`),
      this.prisma.message.groupBy({ by: ['direction'], where: { occurredAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.message.groupBy({ by: ['status'], where: { direction: 'OUTBOUND', occurredAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.message.groupBy({
        by: ['errorCode'],
        where: { status: 'FAILED', occurredAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { errorCode: 'desc' } },
        take: 5,
      }),
      this.prisma.$queryRaw<{ version: number | null; checkpoint: string | null; requests: bigint }[]>(Prisma.sql`
        SELECT v.version, v."checkpointPath" AS checkpoint, COUNT(*) AS requests
        FROM "AIUsage" u LEFT JOIN "ModelVersion" v ON v.id = u."modelVersionId"
        WHERE u."createdAt" >= ${since}
        GROUP BY v.version, v."checkpointPath" ORDER BY requests DESC`),
    ]);

    const a = ai[0];
    const requests = n(a.requests);
    const count = (rows: { _count: { _all: number } }[], pick: (r: never) => string) =>
      Object.fromEntries(rows.map((r) => [pick(r as never), r._count._all]));
    return {
      days,
      since,
      timezone,
      ai: {
        requests,
        succeeded: n(a.succeeded),
        failed: requests - n(a.succeeded),
        successRate: requests ? n(a.succeeded) / requests : null,
        inputTokens: n(a.input),
        outputTokens: n(a.output),
        avgLatencyMs: a.avg === null ? null : Math.round(a.avg),
        p95LatencyMs: a.p95 === null ? null : Math.round(a.p95),
        byModel: byVersion.map((v) => ({ version: v.version, checkpoint: v.checkpoint, requests: n(v.requests) })),
      },
      decisions: {
        byAction: count(actions, (r: { action: string }) => r.action),
        byReason: reasons.map((r) => ({ reason: r.reason, count: r._count._all })),
        outcomes: Object.fromEntries(outcomes.map((o) => [o.outcome, n(o.count)])),
      },
      messages: {
        inbound: directions.find((d) => d.direction === 'INBOUND')?._count._all ?? 0,
        outbound: directions.find((d) => d.direction === 'OUTBOUND')?._count._all ?? 0,
        outboundByStatus: count(outboundStatuses, (r: { status: string }) => r.status),
        failuresByCode: failureCodes.map((f) => ({ code: f.errorCode, count: f._count._all })),
      },
      series: series.map(
        (r): UsageDay => ({
          day: r.day.toISOString().slice(0, 10),
          requests: n(r.requests),
          failures: n(r.failures),
          avgLatencyMs: r.avg === null ? null : Math.round(r.avg),
          inputTokens: n(r.input),
          outputTokens: n(r.output),
        }),
      ),
    };
  }

  /** Message explorer across all conversations. */
  async messages(q: MessageSearchDto) {
    const where: Prisma.MessageWhereInput = {
      direction: q.direction,
      source: q.source,
      status: q.status,
      type: q.type,
      conversationId: q.conversationId,
      ...((q.from || q.to) && { occurredAt: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } }),
      ...(q.search && { body: { contains: q.search, mode: 'insensitive' } }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.message.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: q.skip,
        take: q.pageSize,
        select: {
          id: true,
          direction: true,
          type: true,
          source: true,
          body: true,
          status: true,
          errorCode: true,
          errorMessage: true,
          occurredAt: true,
          sentBy: { select: { name: true } },
          conversation: { select: { id: true, customerName: true, customerWaId: true } },
        },
      }),
      this.prisma.message.count({ where }),
    ]);
    return new Paginated(items, total, q);
  }
}
