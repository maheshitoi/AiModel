import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { AiClientService, AiGenerateRequest } from '../src/ai/ai-client.service';
import { AiReplyService } from '../src/ai/ai-reply.service';
import { ModelRegistryService } from '../src/ai/model-registry.service';
import type { AuthUser } from '../src/common/auth.types';
import { seedDatabase } from '../src/database/seed';
import { AuditService } from '../src/logs/audit.service';
import { SystemLogService } from '../src/logs/system-log.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { LEGACY_DEFAULTS, SETTING_DEFAULTS } from '../src/settings/settings.defaults';
import { SettingsService } from '../src/settings/settings.service';
import { getTestDatabaseUrl } from './test-database';

const TOKEN = 'integration-test-token-'.padEnd(40, 'x');
const prisma = new PrismaClient({ datasources: { db: { url: getTestDatabaseUrl() } } }) as unknown as PrismaService;

const MODEL = {
  name: 'int-run',
  checkpoint: 'int-run/best.pt',
  parameters: 1000,
  context_length: 128,
  vocab_size: 300,
  step: 10,
  best_val_loss: 0.1,
  facts_source: 'run',
  business_name: 'Test clinic',
  loaded_at: '2026-11-03T00:00:00+00:00',
};

// ── fake AI service ──────────────────────────────────────────────────────────
type Reply = { status: number; body: unknown };
const requests: { path: string; token: string | undefined; body: AiGenerateRequest }[] = [];
let nextReply: (body: AiGenerateRequest) => Reply = () => decision('reply', 'model_reply', 'Our hours are 9 to 5.');
let server: Server;

function decision(action: string, reason: string, text: string, extra: object = {}): Reply {
  return {
    status: 200,
    body: {
      request_id: null,
      action,
      text,
      reason,
      detail: null,
      handoff_required: action !== 'reply',
      confidence: action === 'handoff' ? null : 0.9,
      model_text: action === 'handoff' ? null : text,
      usage: { input_tokens: 12, output_tokens: 8 },
      latency_ms: 5,
      model: MODEL,
      ...extra,
    },
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  let data = '';
  for await (const chunk of req) data += chunk;
  return data;
}

// ── services under test ──────────────────────────────────────────────────────
let replies: AiReplyService;
let actor: AuthUser;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const raw = await readBody(req);
    const body = raw ? (JSON.parse(raw) as AiGenerateRequest) : ({} as AiGenerateRequest);
    requests.push({ path: req.url ?? '', token: req.headers['x-internal-token'] as string | undefined, body });
    const reply = req.url === '/v1/models/current' ? { status: 200, body: { loaded: true, model: MODEL, last_load_error: null } } : nextReply(body);
    res.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const values: Record<string, unknown> = { AI_SERVICE_URL: `http://127.0.0.1:${port}`, AI_SERVICE_TOKEN: TOKEN, AI_REQUEST_TIMEOUT_MS: 5000 };
  const config = { getOrThrow: (k: string) => values[k], get: (k: string) => values[k] } as unknown as ConfigService;

  await seedDatabase(prisma);
  // Start from the default generation settings even if a previous run left others behind.
  await prisma.systemSetting.update({ where: { key: 'ai.generation' }, data: { value: SETTING_DEFAULTS['ai.generation'].value as object } });
  const audit = new AuditService(prisma);
  const logs = new SystemLogService(prisma);
  const client = new AiClientService(config);
  const registry = new ModelRegistryService(prisma, client, audit, logs);
  replies = new AiReplyService(prisma, client, registry, new SettingsService(prisma, audit), logs, audit);

  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'OPERATOR' } });
  const user = await prisma.user.create({ data: { email: `op-${Date.now()}@test.local`, name: 'Operator', passwordHash: 'x', roleId: role.id } });
  actor = { id: user.id, email: user.email, name: user.name, role: 'OPERATOR', permissions: [], sessionId: 's' };
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});

beforeEach(() => {
  requests.length = 0;
  nextReply = () => decision('reply', 'model_reply', 'Our hours are 9 to 5.');
});

let seq = 0;
async function conversationWith(texts: string[], opts: { autoReply?: boolean; aiEnabled?: boolean } = {}) {
  seq += 1;
  const account = await prisma.whatsAppAccount.create({
    data: {
      displayName: 'AI test',
      phoneNumber: '+15550000000',
      phoneNumberId: `ai-pnid-${seq}-${Date.now()}`,
      businessAccountId: 'waba',
      accessTokenEncrypted: 'c',
      accessTokenLast4: 'abcd',
      appSecretEncrypted: 'c',
      verifyTokenEncrypted: 'c',
      autoReplyEnabled: opts.autoReply ?? false,
    },
  });
  const convo = await prisma.conversation.create({ data: { whatsAppAccountId: account.id, customerWaId: `1555${seq}`, aiEnabled: opts.aiEnabled ?? true } });
  const start = Date.now() - texts.length * 1000;
  const messages = [];
  for (const [i, text] of texts.entries()) {
    const fromBot = text.startsWith('bot:');
    messages.push(
      await prisma.message.create({
        data: {
          conversationId: convo.id,
          direction: fromBot ? 'OUTBOUND' : 'INBOUND',
          source: fromBot ? 'AI' : 'CUSTOMER',
          status: fromBot ? 'SENT' : 'RECEIVED',
          body: fromBot ? text.slice(4) : text,
          occurredAt: new Date(start + i * 1000),
        },
      }),
    );
  }
  return { convo, last: messages[messages.length - 1] };
}

const generateCalls = () => requests.filter((r) => r.path === '/v1/generate');

describe('AiReplyService.handleInbound', () => {
  it('stores a suggestion while auto-reply is off, with usage and the model version', async () => {
    const { convo, last } = await conversationWith(['hi', 'bot:Hello! How can I help?', 'when are you open?']);

    const d = await replies.handleInbound(last.id);

    expect(d).toMatchObject({ action: 'REPLY', status: 'SUGGESTED', text: 'Our hours are 9 to 5.', outboundMessageId: null });
    const [call] = generateCalls();
    expect(call.token).toBe(TOKEN);
    expect(call.body.request_id).toBe(last.id);
    expect(call.body.messages).toEqual([
      { role: 'customer', text: 'hi' },
      { role: 'assistant', text: 'Hello! How can I help?' },
      { role: 'customer', text: 'when are you open?' },
    ]);
    expect(call.body.options).toMatchObject({ temperature: 0, min_confidence: 0.5 });
    expect(await prisma.message.count({ where: { conversationId: convo.id, direction: 'OUTBOUND', status: 'QUEUED' } })).toBe(0);
    const usage = await prisma.aIUsage.findFirstOrThrow({ where: { conversationId: convo.id } });
    expect(usage).toMatchObject({ success: true, inputTokens: 12, outputTokens: 8 });
    const version = await prisma.modelVersion.findUniqueOrThrow({ where: { checkpointPath: MODEL.checkpoint } });
    expect(d!.modelVersionId).toBe(version.id);
  });

  it('is idempotent: a second call returns the same decision without asking the AI again', async () => {
    const { last } = await conversationWith(['hello']);
    const first = await replies.handleInbound(last.id);
    const second = await replies.handleInbound(last.id);
    expect(second!.id).toBe(first!.id);
    expect(generateCalls()).toHaveLength(1);
  });

  it('keeps one decision when the same message is processed concurrently', async () => {
    const { last } = await conversationWith(['hello there']);
    const results = await Promise.all([replies.handleInbound(last.id), replies.handleInbound(last.id), replies.handleInbound(last.id)]);
    expect(new Set(results.map((r) => r!.id)).size).toBe(1);
    expect(await prisma.aIDecision.count({ where: { inboundMessageId: last.id } })).toBe(1);
  });

  it('queues the reply for sending when auto-reply is on', async () => {
    const { convo, last } = await conversationWith(['when are you open?'], { autoReply: true });

    const d = await replies.handleInbound(last.id);

    expect(d).toMatchObject({ status: 'QUEUED' });
    const out = await prisma.message.findUniqueOrThrow({ where: { id: d!.outboundMessageId! }, include: { statusHistory: true } });
    expect(out).toMatchObject({ direction: 'OUTBOUND', source: 'AI', status: 'QUEUED', body: 'Our hours are 9 to 5.', aiReplyToId: last.id });
    expect(out.statusHistory.map((h) => h.status)).toEqual(['QUEUED']);
    const after = await prisma.conversation.findUniqueOrThrow({ where: { id: convo.id } });
    expect(after.lastMessagePreview).toBe('Our hours are 9 to 5.');
    expect(await prisma.aIUsage.findFirst({ where: { messageId: out.id } })).not.toBeNull();
  });

  it('sends the emergency reply at once even with auto-reply off, and hands the conversation to staff', async () => {
    nextReply = () => decision('handoff', 'emergency', 'Call your local emergency number now.');
    const { convo, last } = await conversationWith(['my dad collapsed']);

    const d = await replies.handleInbound(last.id);

    expect(d).toMatchObject({ action: 'HANDOFF', status: 'QUEUED', handoffRequired: true });
    const after = await prisma.conversation.findUniqueOrThrow({ where: { id: convo.id } });
    expect(after).toMatchObject({ status: 'HUMAN', needsAttention: true, attentionReason: 'emergency' });
    // The AI no longer answers this conversation.
    const next = await prisma.message.create({
      data: { conversationId: convo.id, direction: 'INBOUND', source: 'CUSTOMER', status: 'RECEIVED', body: 'hello?' },
    });
    expect(await replies.handleInbound(next.id)).toBeNull();
  });

  it('flags a fallback for staff but keeps the AI on', async () => {
    nextReply = () => decision('fallback', 'low_confidence', 'A team member will get back to you.');
    const { convo, last } = await conversationWith(['blah']);

    expect(await replies.handleInbound(last.id)).toMatchObject({ action: 'FALLBACK', status: 'SUGGESTED', reason: 'low_confidence' });
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: convo.id } })).toMatchObject({
      status: 'OPEN',
      needsAttention: true,
      attentionReason: 'low_confidence',
    });
  });

  it('records a failure without message text, flags the conversation and can retry later', async () => {
    nextReply = () => ({ status: 503, body: { detail: 'No model is loaded' } });
    const { convo, last } = await conversationWith(['my secret is pineapple']);

    expect(await replies.handleInbound(last.id)).toBeNull();

    expect(await prisma.aIUsage.findFirstOrThrow({ where: { conversationId: convo.id } })).toMatchObject({ success: false });
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: convo.id } })).toMatchObject({ attentionReason: 'ai_unavailable' });
    const log = await prisma.systemLog.findFirstOrThrow({ where: { event: 'ai.request_failed', conversationId: convo.id } });
    expect(JSON.stringify(log)).not.toContain('pineapple');

    nextReply = () => decision('reply', 'model_reply', 'Hi!');
    expect(await replies.handleInbound(last.id)).toMatchObject({ action: 'REPLY' });
  });

  it('skips messages the AI should not answer', async () => {
    const off = await conversationWith(['hi'], { aiEnabled: false });
    expect(await replies.handleInbound(off.last.id)).toBeNull();

    const { convo } = await conversationWith(['first', 'second']);
    const first = await prisma.message.findFirstOrThrow({ where: { conversationId: convo.id, body: 'first' } });
    expect(await replies.handleInbound(first.id)).toBeNull(); // a newer customer message is waiting

    expect(generateCalls()).toHaveLength(0);
  });
});

describe('reviewing suggestions', () => {
  it('approves an edited suggestion as a staff-written reply, exactly once', async () => {
    const { last } = await conversationWith(['when are you open?']);
    const d = await replies.handleInbound(last.id);

    const approved = await replies.approve(d!.id, 'We open at 9.', actor, {});

    expect(approved).toMatchObject({ status: 'QUEUED', reviewedById: actor.id });
    const out = await prisma.message.findUniqueOrThrow({ where: { id: approved.outboundMessageId! } });
    expect(out).toMatchObject({ source: 'HUMAN', sentById: actor.id, body: 'We open at 9.', aiReplyToId: last.id });
    await expect(replies.approve(d!.id, undefined, actor, {})).rejects.toThrow(ConflictException);
    await expect(replies.dismiss(d!.id, actor, {})).rejects.toThrow(ConflictException);
    expect(await prisma.auditLog.count({ where: { action: 'ai_decision.approve', entityId: d!.id } })).toBe(1);
  });

  it('approving unchanged keeps the AI as the author; dismissing sends nothing', async () => {
    const a = await conversationWith(['a?']);
    const da = await replies.handleInbound(a.last.id);
    const approved = await replies.approve(da!.id, 'Our hours are 9 to 5.', actor, {});
    expect(await prisma.message.findUniqueOrThrow({ where: { id: approved.outboundMessageId! } })).toMatchObject({ source: 'AI', sentById: null });

    const b = await conversationWith(['b?']);
    const db = await replies.handleInbound(b.last.id);
    expect(await replies.dismiss(db!.id, actor, {})).toMatchObject({ status: 'DISMISSED', outboundMessageId: null });
  });
});

describe('seed upgrades untouched legacy defaults', () => {
  it('replaces the old ai.generation default but keeps user changes', async () => {
    const legacy = LEGACY_DEFAULTS['ai.generation']![0];
    await prisma.systemSetting.update({ where: { key: 'ai.generation' }, data: { value: legacy as object } });
    await seedDatabase(prisma);
    expect((await prisma.systemSetting.findUniqueOrThrow({ where: { key: 'ai.generation' } })).value).toEqual(SETTING_DEFAULTS['ai.generation'].value);

    const custom = { ...legacy, temperature: 0.3 };
    await prisma.systemSetting.update({ where: { key: 'ai.generation' }, data: { value: custom } });
    await seedDatabase(prisma);
    expect((await prisma.systemSetting.findUniqueOrThrow({ where: { key: 'ai.generation' } })).value).toEqual(custom);
  });
});
