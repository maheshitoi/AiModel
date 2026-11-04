import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { hashPassword } from '../src/auth/password';
import { seedDatabase } from '../src/database/seed';
import { getTestDatabaseUrl } from './test-database';

// ── fake Meta Graph API and AI service ───────────────────────────────────────
interface Seen {
  method: string;
  path: string;
  auth?: string;
  body: Record<string, unknown>;
}
const graphCalls: Seen[] = [];
const aiCalls: Seen[] = [];
let graphReply: () => { status: number; body: unknown } = () => ({ status: 200, body: { messages: [{ id: `wamid.OUT-${graphCalls.length}` }] } });
let aiReply: () => object = () => aiDecision('reply', 'model_reply', 'We are open 9 to 5.');

function aiDecision(action: string, reason: string, text: string) {
  return {
    request_id: null,
    action,
    text,
    reason,
    detail: null,
    handoff_required: action !== 'reply',
    confidence: 0.9,
    model_text: text,
    usage: { input_tokens: 5, output_tokens: 5 },
    latency_ms: 3,
    model: { name: 'wa-run', checkpoint: 'wa-run/best.pt', parameters: 1, context_length: 128, vocab_size: 10, step: 1, best_val_loss: 1, facts_source: 'run', business_name: 'x', loaded_at: 'x' },
  };
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function fakeServer(handler: (seen: Seen) => { status: number; body: unknown }, log: Seen[]): Promise<Server> {
  const server = createServer(async (req, res) => {
    const seen = { method: req.method ?? '', path: req.url ?? '', auth: req.headers.authorization, body: await body(req) };
    log.push(seen);
    const reply = handler(seen);
    res.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply.body));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
const urlOf = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

// ── app under test ───────────────────────────────────────────────────────────
const APP_SECRET = 'meta-app-secret-for-tests';
const VERIFY_TOKEN = 'verify-token-for-tests-123';
const ACCESS_TOKEN = 'EAAG-access-token-for-tests';
// Unique per run, so the suite also works on a database that wasn't reset.
const PHONE_ID = `1${Date.now()}`;
const prisma = new PrismaClient({ datasources: { db: { url: getTestDatabaseUrl() } } });
let app: INestApplication;
let base: string;
let graph: Server;
let ai: Server;
let sender: { processDue: (now?: Date) => Promise<number> };
let jwt: string;
let accountId: string;

const sign = (raw: string) => `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;

async function webhook(payload: object, signature?: string) {
  const raw = JSON.stringify(payload);
  return fetch(`${base}/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature ?? sign(raw) },
    body: raw,
  });
}

let seq = 0;
function inboundPayload(text: string, from = '15557770001', id = `wamid.IN-${PHONE_ID}-${++seq}`, timestamp = Math.floor(Date.now() / 1000)) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550102030', phone_number_id: PHONE_ID },
              contacts: [{ wa_id: from, profile: { name: 'Priya' } }],
              messages: [{ id, from, timestamp: String(timestamp), type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
}

function statusPayload(wamid: string, status: string, timestamp: number, errors?: object[]) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID }, statuses: [{ id: wamid, status, timestamp: String(timestamp), recipient_id: '1', errors }] } }] }],
  };
}

async function until<T>(fn: () => Promise<T | null | undefined>, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const api = (path: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, ...init.headers } });

beforeAll(async () => {
  graph = await fakeServer(() => graphReply(), graphCalls);
  ai = await fakeServer((s) => (s.path === '/v1/models/current' ? { status: 200, body: { loaded: true, model: null, last_load_error: null } } : { status: 200, body: aiReply() }), aiCalls);
  Object.assign(process.env, {
    DATABASE_URL: getTestDatabaseUrl(),
    AI_SERVICE_URL: urlOf(ai),
    AI_SERVICE_TOKEN: 'x'.repeat(40),
    WHATSAPP_GRAPH_URL: urlOf(graph),
    WHATSAPP_GRAPH_VERSION: 'v23.0',
    WHATSAPP_SENDER_INTERVAL_MS: '0', // the test drives the sender
    CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    JWT_ACCESS_SECRET: 'j'.repeat(48),
  });
  // Imported after the environment is set: ConfigModule validates it at import time.
  const { AppModule } = await import('../src/app.module');
  const { MessageSenderService } = await import('../src/whatsapp/message-sender.service');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api/v1`.replace('[::1]', '127.0.0.1');
  sender = app.get(MessageSenderService);

  await seedDatabase(prisma);
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
  const email = `wa-admin-${Date.now()}@test.local`;
  await prisma.user.create({ data: { email, name: 'WA admin', passwordHash: await hashPassword('correct-horse-battery'), roleId: role.id } });
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-battery' }) });
  jwt = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;

  const created = await api('/whatsapp/accounts', {
    method: 'POST',
    body: JSON.stringify({
      displayName: 'Test clinic',
      phoneNumber: '+15550102030',
      phoneNumberId: PHONE_ID,
      businessAccountId: '20000000001',
      accessToken: ACCESS_TOKEN,
      appSecret: APP_SECRET,
      verifyToken: VERIFY_TOKEN,
      autoReplyEnabled: true,
    }),
  });
  expect(created.status).toBe(201);
  accountId = ((await created.json()) as { data: { id: string } }).data.id;
});

afterAll(async () => {
  await app?.close();
  await Promise.all([graph, ai].map((s) => new Promise((r) => s.close(r))));
  await prisma.$disconnect();
});

beforeEach(() => {
  graphCalls.length = 0;
  aiCalls.length = 0;
  graphReply = () => ({ status: 200, body: { messages: [{ id: `wamid.OUT-${Date.now()}-${graphCalls.length}` }] } });
  aiReply = () => aiDecision('reply', 'model_reply', 'We are open 9 to 5.');
});

describe('accounts API', () => {
  it('never returns credentials and stores them encrypted', async () => {
    const res = await api('/whatsapp/accounts');
    const text = await res.text();
    expect(res.status).toBe(200);
    for (const secret of [ACCESS_TOKEN, APP_SECRET, VERIFY_TOKEN, 'Encrypted']) expect(text).not.toContain(secret);
    expect(text).toContain('"accessTokenLast4":"ests"');
    const row = await prisma.whatsAppAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(row.accessTokenEncrypted).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain(ACCESS_TOKEN);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'whatsapp.account.create', entityId: accountId } });
    expect(JSON.stringify(audit)).not.toContain(ACCESS_TOKEN);
  });

  it('verifies credentials against the Graph API', async () => {
    graphReply = () => ({ status: 200, body: { display_phone_number: '+1 555 010 2030', verified_name: 'Test clinic' } });
    const res = await api(`/whatsapp/accounts/${accountId}/verify`, { method: 'POST' });
    const data = ((await res.json()) as { data: { status: string; verification: { ok: boolean } } }).data;
    expect(data).toMatchObject({ status: 'CONNECTED', verification: { ok: true } });
    expect(graphCalls[0]).toMatchObject({ method: 'GET', auth: `Bearer ${ACCESS_TOKEN}` });
    expect(graphCalls[0].path).toBe(`/v23.0/${PHONE_ID}?fields=display_phone_number,verified_name,quality_rating`);
  });
});

describe('webhook verification (GET)', () => {
  it('echoes the challenge for the right verify token only', async () => {
    const ok = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('1158201444');
    const bad = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`);
    expect(bad.status).toBe(403);
  });
});

describe('inbound → AI → send → statuses', () => {
  it('rejects unsigned or forged webhooks and stores nothing', async () => {
    const payload = inboundPayload('forged');
    expect((await webhook(payload, 'sha256=' + '0'.repeat(64))).status).toBe(401);
    expect((await webhook(payload, '')).status).toBe(401);
    expect(await prisma.message.count({ where: { body: 'forged' } })).toBe(0);
  });

  it('stores the message, gets an AI reply, sends it and tracks delivery', async () => {
    const payload = inboundPayload('when are you open?', '15557770001');
    const res = await webhook(payload);
    expect(res.status).toBe(200);

    const inbound = await prisma.message.findUniqueOrThrow({ where: { waMessageId: payload.entry[0].changes[0].value.messages[0].id }, include: { conversation: true } });
    expect(inbound).toMatchObject({ direction: 'INBOUND', type: 'TEXT', body: 'when are you open?' });
    expect(inbound.conversation).toMatchObject({ customerName: 'Priya', unreadCount: 1 }); // the preview may already be the AI reply

    const decision = await until(() => prisma.aIDecision.findUnique({ where: { inboundMessageId: inbound.id } }));
    expect(decision.status).toBe('QUEUED'); // auto-reply is on for this account
    // The sender is kicked after the decision; drive any remaining pass deterministically.
    await sender.processDue();
    const out = await until(() => prisma.message.findFirst({ where: { id: decision.outboundMessageId!, status: 'SENT' } }));
    const send = graphCalls.find((c) => c.method === 'POST')!;
    expect(send.path).toBe(`/v23.0/${PHONE_ID}/messages`);
    expect(send.auth).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(send.body).toMatchObject({ to: '15557770001', type: 'text', text: { body: 'We are open 9 to 5.' } });

    const t = Math.floor(Date.now() / 1000);
    await webhook(statusPayload(out.waMessageId!, 'read', t + 2));
    await webhook(statusPayload(out.waMessageId!, 'delivered', t + 1)); // arrives late
    const after = await prisma.message.findUniqueOrThrow({ where: { id: out.id }, include: { statusHistory: { orderBy: { occurredAt: 'asc' } } } });
    expect(after.status).toBe('READ');
    expect(after.statusHistory.map((h) => h.status)).toEqual(['QUEUED', 'SENT', 'DELIVERED', 'READ']);
  });

  it('ignores a redelivered webhook', async () => {
    const payload = inboundPayload('hello again', '15557770002');
    await webhook(payload);
    const first = await until(() => prisma.message.findUnique({ where: { waMessageId: payload.entry[0].changes[0].value.messages[0].id } }));
    await until(() => prisma.aIDecision.findUnique({ where: { inboundMessageId: first.id } }));
    await webhook(payload);
    await new Promise((r) => setTimeout(r, 200));
    expect(await prisma.message.count({ where: { conversationId: first.conversationId, direction: 'INBOUND' } })).toBe(1);
    expect(aiCalls.filter((c) => c.path === '/v1/generate')).toHaveLength(1);
  });

  it('records a delivery failure from WhatsApp and flags the conversation', async () => {
    const payload = inboundPayload('ping', '15557770003');
    await webhook(payload);
    const inbound = await until(() => prisma.message.findUnique({ where: { waMessageId: payload.entry[0].changes[0].value.messages[0].id } }));
    const decision = await until(() => prisma.aIDecision.findUnique({ where: { inboundMessageId: inbound.id } }));
    await sender.processDue();
    const out = await until(() => prisma.message.findFirst({ where: { id: decision.outboundMessageId!, status: 'SENT' } }));

    await webhook(statusPayload(out.waMessageId!, 'failed', Math.floor(Date.now() / 1000), [{ code: 131026, title: 'Message undeliverable' }]));
    expect(await prisma.message.findUniqueOrThrow({ where: { id: out.id } })).toMatchObject({ status: 'FAILED', errorCode: '131026' });
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: out.conversationId } })).toMatchObject({ needsAttention: true, attentionReason: 'delivery_failed' });
  });
});

describe('sender rules', () => {
  async function queued(lastInboundAt: Date) {
    const convo = await prisma.conversation.create({ data: { whatsAppAccountId: accountId, customerWaId: `1555888${++seq}`, lastInboundAt } });
    return prisma.message.create({ data: { conversationId: convo.id, direction: 'OUTBOUND', source: 'HUMAN', status: 'QUEUED', body: 'Following up' } });
  }

  it('refuses free-form messages outside the 24-hour window without calling WhatsApp', async () => {
    const m = await queued(new Date(Date.now() - 25 * 3600_000));
    await sender.processDue();
    expect(await prisma.message.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: 'FAILED', errorCode: 'outside_24h_window' });
    expect(graphCalls).toHaveLength(0);
  });

  it('retries temporary failures later and gives up on permanent ones', async () => {
    graphReply = () => ({ status: 429, body: { error: { message: 'Rate limit hit', code: 130429 } } });
    const m = await queued(new Date());
    const now = new Date();
    await sender.processDue(now);
    const retry = await prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(retry).toMatchObject({ status: 'QUEUED', retryCount: 1, errorCode: '130429' });
    expect(retry.nextAttemptAt!.getTime() - now.getTime()).toBe(30_000);
    await sender.processDue(now); // not due yet
    expect(graphCalls).toHaveLength(1);

    graphReply = () => ({ status: 400, body: { error: { message: 'Invalid parameter', code: 100 } } });
    await sender.processDue(new Date(now.getTime() + 31_000));
    expect(await prisma.message.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: 'FAILED', errorCode: '100' });
  });

  it('marks the account as ERROR when WhatsApp rejects the token', async () => {
    graphReply = () => ({ status: 401, body: { error: { message: 'Error validating access token', code: 190 } } });
    const m = await queued(new Date());
    await sender.processDue();
    expect(await prisma.message.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: 'FAILED', errorCode: '190' });
    expect(await prisma.whatsAppAccount.findUniqueOrThrow({ where: { id: accountId } })).toMatchObject({ status: 'ERROR' });
    await prisma.whatsAppAccount.update({ where: { id: accountId }, data: { status: 'CONNECTED' } });
  });

  it('never sends a message twice when passes overlap', async () => {
    const m = await queued(new Date());
    await Promise.all([sender.processDue(), sender.processDue(), sender.processDue()]);
    expect(graphCalls.filter((c) => (c.body as { text?: { body?: string } }).text?.body === 'Following up')).toHaveLength(1);
    expect(await prisma.message.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: 'SENT' });
  });
});
