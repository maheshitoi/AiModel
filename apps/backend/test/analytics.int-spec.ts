import { PrismaClient } from '@prisma/client';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { seedDatabase } from '../src/database/seed';
import { AuditService } from '../src/logs/audit.service';
import { LogRetentionService } from '../src/logs/log-retention.service';
import { SystemLogService } from '../src/logs/system-log.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/settings/settings.service';
import { getTestDatabaseUrl } from './test-database';

// Other suites share this database, so assertions compare before/after rather than absolute totals.
const prisma = new PrismaClient({ datasources: { db: { url: getTestDatabaseUrl() } } }) as unknown as PrismaService;
const RUN = Date.now();
let analytics: AnalyticsService;
let settings: SettingsService;

beforeAll(async () => {
  await seedDatabase(prisma);
  settings = new SettingsService(prisma, new AuditService(prisma));
  analytics = new AnalyticsService(prisma, settings);
});
afterAll(() => prisma.$disconnect());

async function conversation() {
  const account = await prisma.whatsAppAccount.create({
    data: {
      displayName: 'Analytics',
      phoneNumber: '+15550000009',
      phoneNumberId: `an-${RUN}-${Math.random()}`,
      businessAccountId: 'w',
      accessTokenEncrypted: 'c',
      accessTokenLast4: 'abcd',
      appSecretEncrypted: 'c',
      verifyTokenEncrypted: 'c',
    },
  });
  return prisma.conversation.create({ data: { whatsAppAccountId: account.id, customerWaId: `1999${RUN % 1e6}` } });
}

describe('usage analytics', () => {
  it('counts AI requests, latency, tokens, decision outcomes and delivery results', async () => {
    const before = await analytics.usage(7);
    const c = await conversation();
    const inbound = async (body: string) => prisma.message.create({ data: { conversationId: c.id, direction: 'INBOUND', source: 'CUSTOMER', status: 'RECEIVED', body } });
    const outbound = async (source: 'AI' | 'HUMAN', status: 'SENT' | 'FAILED' | 'READ', errorCode?: string) =>
      prisma.message.create({ data: { conversationId: c.id, direction: 'OUTBOUND', source, status, body: 'x', errorCode } });

    for (const [ms, ok] of [[100, true], [200, true], [300, true], [5000, false]] as const) {
      await prisma.aIUsage.create({ data: { conversationId: c.id, inputTokens: ok ? 10 : 0, outputTokens: ok ? 5 : 0, latencyMs: ms, success: ok } });
    }
    const reviewer = await prisma.user.findFirstOrThrow();
    const decide = async (status: 'SUGGESTED' | 'QUEUED' | 'DISMISSED', action: 'REPLY' | 'HANDOFF', reason: string, out?: { source: 'AI' | 'HUMAN' }, reviewed = true) => {
      const m = await inbound(reason);
      const o = out ? await outbound(out.source, 'SENT') : null;
      await prisma.aIDecision.create({
        data: {
          conversationId: c.id,
          inboundMessageId: m.id,
          action,
          reason,
          text: 't',
          handoffRequired: action === 'HANDOFF',
          status,
          outboundMessageId: o?.id,
          reviewedById: reviewed && status !== 'SUGGESTED' ? reviewer.id : null,
        },
      });
    };
    await decide('QUEUED', 'HANDOFF', 'emergency', { source: 'AI' }, false); // sent automatically
    await decide('QUEUED', 'REPLY', 'model_reply', { source: 'AI' }); // approved as written
    await decide('QUEUED', 'REPLY', 'model_reply', { source: 'HUMAN' }); // edited
    await decide('DISMISSED', 'REPLY', 'model_reply');
    await decide('SUGGESTED', 'REPLY', 'model_reply');
    await outbound('HUMAN', 'FAILED', '131026');
    await outbound('AI', 'READ');

    const after = await analytics.usage(7);
    const diff = (a: number | undefined, b: number | undefined) => (a ?? 0) - (b ?? 0);
    expect(after.ai.requests - before.ai.requests).toBe(4);
    expect(after.ai.failed - before.ai.failed).toBe(1);
    expect(after.ai.inputTokens - before.ai.inputTokens).toBe(30);
    expect(after.ai.outputTokens - before.ai.outputTokens).toBe(15);
    expect(diff(after.decisions.byAction.HANDOFF, before.decisions.byAction.HANDOFF)).toBe(1);
    expect(diff(after.decisions.byAction.REPLY, before.decisions.byAction.REPLY)).toBe(4);
    for (const [k, v] of Object.entries({ automatic: 1, approved: 1, edited: 1, dismissed: 1, pending: 1 })) {
      expect(diff(after.decisions.outcomes[k], before.decisions.outcomes[k])).toBe(v);
    }
    expect(after.messages.inbound - before.messages.inbound).toBe(5);
    expect(after.messages.outbound - before.messages.outbound).toBe(5);
    expect(diff(after.messages.outboundByStatus.FAILED, before.messages.outboundByStatus.FAILED)).toBe(1);
    expect(after.messages.failuresByCode.find((f) => f.code === '131026')?.count).toBeGreaterThanOrEqual(1);

    // Series: 7 local days ending today; today's bucket gained the 4 requests.
    expect(after.series).toHaveLength(7);
    const today = (s: typeof after) => s.series[s.series.length - 1];
    expect(today(after).requests - today(before).requests).toBe(4);
    expect(today(after).failures - today(before).failures).toBe(1);
    expect(after.ai.p95LatencyMs).not.toBeNull();
    expect(after.ai.successRate).toBeGreaterThan(0);
  });

  it('buckets by the configured timezone', async () => {
    await prisma.systemSetting.update({ where: { key: 'system' }, data: { value: { timezone: 'Pacific/Kiritimati', logRetentionDays: 90 } } }); // UTC+14
    const fresh = new AnalyticsService(prisma, new SettingsService(prisma, new AuditService(prisma)));
    const res = await fresh.usage(7);
    const localToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati' }).format(new Date());
    expect(res.series.at(-1)!.day).toBe(localToday);
    await prisma.systemSetting.update({ where: { key: 'system' }, data: { value: { timezone: 'UTC', logRetentionDays: 90 } } });
  });
});

describe('message explorer', () => {
  it('filters by direction, status and text', async () => {
    const c = await conversation();
    await prisma.message.create({ data: { conversationId: c.id, direction: 'INBOUND', source: 'CUSTOMER', status: 'RECEIVED', body: `find-me-${RUN} please` } });
    await prisma.message.create({ data: { conversationId: c.id, direction: 'OUTBOUND', source: 'AI', status: 'FAILED', body: `find-me-${RUN} reply` } });

    const page = (q: object) => analytics.messages({ page: 1, pageSize: 20, skip: 0, search: `find-me-${RUN}`, ...q } as never);
    expect((await page({})).meta.total).toBe(2);
    expect((await page({ direction: 'INBOUND' })).items.map((m) => m.body)).toEqual([`find-me-${RUN} please`]);
    const failed = await page({ status: 'FAILED' });
    expect(failed.items).toHaveLength(1);
    expect(failed.items[0].conversation).toMatchObject({ id: c.id, customerWaId: c.customerWaId });
  });
});

describe('log retention', () => {
  it('deletes system logs older than the retention period and keeps newer ones', async () => {
    const old = await prisma.systemLog.create({ data: { level: 'INFO', category: 'BACKEND', event: `old-${RUN}`, message: 'old', createdAt: new Date(Date.now() - 91 * 86_400_000) } });
    const recent = await prisma.systemLog.create({ data: { level: 'INFO', category: 'BACKEND', event: `recent-${RUN}`, message: 'recent' } });
    const retention = new LogRetentionService(prisma, settings, new SystemLogService(prisma));

    expect(await retention.purge()).toBeGreaterThanOrEqual(1);
    expect(await prisma.systemLog.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.systemLog.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });
});
