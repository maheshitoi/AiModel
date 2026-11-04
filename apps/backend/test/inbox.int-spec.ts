import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import { hashPassword } from '../src/auth/password';
import { seedDatabase } from '../src/database/seed';
import { getTestDatabaseUrl } from './test-database';

const prisma = new PrismaClient({ datasources: { db: { url: getTestDatabaseUrl() } } });
const RUN = Date.now();
const PHONE_ID = `2${RUN}`;
const APP_SECRET = 'inbox-app-secret-for-tests';
let app: INestApplication;
let origin: string;
let base: string;
let graph: Server;
const graphSends: { to: string; text: string }[] = [];
let sender: { processDue: (now?: Date) => Promise<number> };
let adminJwt: string;
let viewerJwt: string;
let accountId: string;

async function login(role: string): Promise<string> {
  const email = `inbox-${role.toLowerCase()}-${RUN}@test.local`;
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  await prisma.user.create({ data: { email, name: `${role} user`, passwordHash: await hashPassword('correct-horse-battery'), roleId: roleRow.id } });
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-battery' }) });
  return ((await res.json()) as { data: { accessToken: string } }).data.accessToken;
}

const api = (path: string, init: RequestInit = {}, jwt = adminJwt) =>
  fetch(`${base}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, ...init.headers } });
const json = async <T>(res: Response) => ((await res.json()) as { data: T }).data;

let seq = 0;
async function conversation(data: Partial<{ customerName: string; status: 'OPEN' | 'HUMAN' | 'CLOSED'; needsAttention: boolean; lastInboundAt: Date | null; lastMessageAt: Date }> = {}) {
  return prisma.conversation.create({
    data: { whatsAppAccountId: accountId, customerWaId: `1777${RUN % 100000}${++seq}`, lastInboundAt: new Date(), lastMessageAt: new Date(), ...data },
  });
}

function connect(token?: string): Promise<{ socket: Socket; ok: boolean }> {
  return new Promise((resolve) => {
    const socket = io(origin, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false });
    socket.on('auth_error', () => resolve({ socket, ok: false }));
    socket.on('disconnect', () => resolve({ socket, ok: false }));
    // The server only joins the room after authenticating; give it a moment before trusting "connect".
    socket.on('connect', () => setTimeout(() => resolve({ socket, ok: socket.connected }), 300));
  });
}

beforeAll(async () => {
  graph = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as { to?: string; text?: { body?: string } };
      graphSends.push({ to: body.to ?? '', text: body.text?.body ?? '' });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ messages: [{ id: `wamid.INBOX-${RUN}-${graphSends.length}` }] }));
    });
  });
  await new Promise<void>((r) => graph.listen(0, '127.0.0.1', r));
  Object.assign(process.env, {
    DATABASE_URL: getTestDatabaseUrl(),
    AI_SERVICE_URL: 'http://127.0.0.1:9', // unreachable: these tests don't need the AI
    AI_SERVICE_TOKEN: 'x'.repeat(40),
    WHATSAPP_GRAPH_URL: `http://127.0.0.1:${(graph.address() as AddressInfo).port}`,
    WHATSAPP_SENDER_INTERVAL_MS: '0',
    CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    JWT_ACCESS_SECRET: 'j'.repeat(48),
  });
  const { AppModule } = await import('../src/app.module');
  const { MessageSenderService } = await import('../src/whatsapp/message-sender.service');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  origin = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  base = `${origin}/api/v1`;
  sender = app.get(MessageSenderService);

  await seedDatabase(prisma);
  adminJwt = await login('ADMIN');
  viewerJwt = await login('VIEWER');
  const created = await api('/whatsapp/accounts', {
    method: 'POST',
    body: JSON.stringify({
      displayName: 'Inbox test',
      phoneNumber: '+15550102031',
      phoneNumberId: PHONE_ID,
      businessAccountId: '20000000002',
      accessToken: 'EAAG-inbox-access-token-xyz',
      appSecret: APP_SECRET,
      verifyToken: 'inbox-verify-token-123',
    }),
  });
  accountId = (await json<{ id: string }>(created)).id;
  await prisma.whatsAppAccount.update({ where: { id: accountId }, data: { status: 'CONNECTED' } });
});

afterAll(async () => {
  await app?.close();
  await new Promise((r) => graph.close(r));
  await prisma.$disconnect();
});

describe('conversation list', () => {
  it('filters, searches and sorts newest first', async () => {
    const t = Date.now();
    const attention = await conversation({ customerName: `Attention ${RUN}`, needsAttention: true, lastMessageAt: new Date(t - 1000) });
    const human = await conversation({ customerName: `Human ${RUN}`, status: 'HUMAN', lastMessageAt: new Date(t - 2000) });
    const closed = await conversation({ customerName: `Closed ${RUN}`, status: 'CLOSED', lastMessageAt: new Date(t) });

    const ids = async (query: string) =>
      (await json<{ id: string }[]>(await api(`/conversations?pageSize=100&search=${RUN}&${query}`))).map((c) => c.id);
    expect(await ids('filter=all')).toEqual([attention.id, human.id]); // closed left out, newest first
    expect(await ids('filter=attention')).toEqual([attention.id]);
    expect(await ids('filter=human')).toEqual([human.id]);
    expect(await ids('filter=closed')).toEqual([closed.id]);
    const byPhone = await json<{ id: string }[]>(await api(`/conversations?search=${encodeURIComponent('+' + human.customerWaId)}`));
    expect(byPhone.map((c) => c.id)).toEqual([human.id]);
  });

  it('requires conversations:read', async () => {
    expect((await api('/conversations', {}, viewerJwt)).status).toBe(403);
  });
});

describe('messages and replies', () => {
  it('pages back through messages', async () => {
    const c = await conversation();
    for (let i = 0; i < 5; i++) {
      await prisma.message.create({ data: { conversationId: c.id, direction: 'INBOUND', source: 'CUSTOMER', status: 'RECEIVED', body: `m${i}`, occurredAt: new Date(Date.now() - (5 - i) * 1000) } });
    }
    const first = await json<{ items: { body: string; occurredAt: string }[]; hasMore: boolean }>(await api(`/conversations/${c.id}/messages?limit=3`));
    expect(first.items.map((m) => m.body)).toEqual(['m4', 'm3', 'm2']);
    expect(first.hasMore).toBe(true);
    const older = await json<{ items: { body: string }[]; hasMore: boolean }>(
      await api(`/conversations/${c.id}/messages?limit=3&before=${encodeURIComponent(first.items[2].occurredAt)}`),
    );
    expect(older.items.map((m) => m.body)).toEqual(['m1', 'm0']);
    expect(older.hasMore).toBe(false);
  });

  it('queues a staff reply, dismisses pending suggestions and sends it', async () => {
    const c = await conversation({ customerName: 'Reply test' });
    const inbound = await prisma.message.create({ data: { conversationId: c.id, direction: 'INBOUND', source: 'CUSTOMER', status: 'RECEIVED', body: 'hello?' } });
    await prisma.aIDecision.create({
      data: { conversationId: c.id, inboundMessageId: inbound.id, action: 'REPLY', reason: 'model_reply', text: 'Hi!', handoffRequired: false, status: 'SUGGESTED' },
    });
    expect((await json<{ pendingDecision: unknown }>(await api(`/conversations/${c.id}`))).pendingDecision).not.toBeNull();

    const res = await api(`/conversations/${c.id}/messages`, { method: 'POST', body: JSON.stringify({ text: '  Hello from the team  ' }) });
    expect(res.status).toBe(201);
    const { id } = await json<{ id: string }>(res);
    expect(await prisma.message.findUniqueOrThrow({ where: { id } })).toMatchObject({ source: 'HUMAN', status: 'QUEUED', body: 'Hello from the team' });
    expect(await prisma.aIDecision.count({ where: { conversationId: c.id, status: 'SUGGESTED' } })).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'conversation.reply', entityId: id } });
    expect(JSON.stringify(audit)).not.toContain('Hello from the team');

    await sender.processDue();
    expect(await prisma.message.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'SENT' });
    expect(graphSends.at(-1)).toEqual({ to: c.customerWaId, text: 'Hello from the team' });
  });

  it('refuses free-form replies outside the 24-hour window', async () => {
    const c = await conversation({ lastInboundAt: new Date(Date.now() - 25 * 3600_000) });
    const res = await api(`/conversations/${c.id}/messages`, { method: 'POST', body: JSON.stringify({ text: 'Are you still there?' }) });
    expect(res.status).toBe(409);
    expect(await prisma.message.count({ where: { conversationId: c.id } })).toBe(0);
    const detail = await json<{ replyWindowEndsAt: string }>(await api(`/conversations/${c.id}`));
    expect(new Date(detail.replyWindowEndsAt).getTime()).toBeLessThan(Date.now());
  });

  it('retries a failed message once', async () => {
    const c = await conversation();
    const failed = await prisma.message.create({
      data: { conversationId: c.id, direction: 'OUTBOUND', source: 'HUMAN', status: 'FAILED', body: 'Retry me', errorCode: '131000', retryCount: 4 },
    });
    const res = await api(`/conversations/${c.id}/messages/${failed.id}/retry`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await api(`/conversations/${c.id}/messages/${failed.id}/retry`, { method: 'POST' })).status).toBe(409);
    await sender.processDue();
    expect(await prisma.message.findUniqueOrThrow({ where: { id: failed.id } })).toMatchObject({ status: 'SENT', retryCount: 0, errorCode: null });
  });
});

describe('staff actions', () => {
  it('takes over, hands back and resolves, with an audit trail', async () => {
    const c = await conversation({ needsAttention: true });
    const patch = (body: object) => api(`/conversations/${c.id}`, { method: 'PATCH', body: JSON.stringify(body) });

    expect(await json<{ status: string }>(await patch({ status: 'HUMAN' }))).toMatchObject({ status: 'HUMAN' });
    expect(await json<{ status: string; needsAttention: boolean }>(await patch({ status: 'OPEN', needsAttention: false }))).toMatchObject({ status: 'OPEN', needsAttention: false });
    expect((await patch({ needsAttention: true })).status).toBe(400);
    expect((await patch({ assignedToId: '01a1a0e5-7f7b-7923-b3ac-700c6a02cd2c' })).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { action: 'conversation.update', entityId: c.id } })).toBe(2);

    const read = await api(`/conversations/${c.id}/read`, { method: 'POST' });
    expect(read.status).toBe(204);
  });
});

describe('live updates (Socket.IO)', () => {
  it('rejects sockets without a valid token or without inbox access', async () => {
    const none = await connect();
    expect(none.ok).toBe(false);
    none.socket.close();
    const bad = await connect('not-a-jwt');
    expect(bad.ok).toBe(false);
    bad.socket.close();
    const viewer = await connect(viewerJwt);
    expect(viewer.ok).toBe(false);
    viewer.socket.close();
  });

  it('pushes id-only events when a customer message arrives', async () => {
    const { socket, ok } = await connect(adminJwt);
    expect(ok).toBe(true);
    const events: Record<string, string>[] = [];
    socket.on('inbox', (e: Record<string, string>) => events.push(e));

    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: PHONE_ID },
                contacts: [{ wa_id: '15559990000', profile: { name: 'Live' } }],
                messages: [{ id: `wamid.LIVE-${RUN}`, from: '15559990000', timestamp: String(Math.floor(Date.now() / 1000)), type: 'image', image: { id: 'm', caption: 'secret caption' } }],
              },
            },
          ],
        },
      ],
    });
    const signature = `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;
    await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature }, body: raw });
    await new Promise((r) => setTimeout(r, 300));
    socket.close();

    const stored = await prisma.message.findUniqueOrThrow({ where: { waMessageId: `wamid.LIVE-${RUN}` } });
    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'message.changed', conversationId: stored.conversationId, messageId: stored.id },
        { type: 'conversation.changed', conversationId: stored.conversationId },
      ]),
    );
    expect(JSON.stringify(events)).not.toContain('secret caption');
  });
});
