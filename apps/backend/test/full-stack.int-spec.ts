/**
 * Full-stack integration (Phase 15): the real Python AI service as a separate process, the backend,
 * the test database and a fake WhatsApp Graph API. One lifecycle, end to end:
 *
 *   upload dataset → approve → activate → train a tiny model (real subprocess) → evaluate → activate
 *   → customer WhatsApp message → real model + guardrails → suggestion / immediate safety reply
 *   → approve → sent to Graph → delivery status
 *
 * Needs the Python venv (.venv at the repo root). Without it the suite is skipped, with a message.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { ChildProcess, execSync, spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { AddressInfo, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from '../src/auth/password';
import { seedDatabase } from '../src/database/seed';
import { REPO_ROOT, getTestDatabaseUrl } from './test-database';

const PYTHON = [join(REPO_ROOT, '.venv', 'Scripts', 'python.exe'), join(REPO_ROOT, '.venv', 'bin', 'python')].find(existsSync);
const suite = PYTHON ? describe : describe.skip;
if (!PYTHON) console.warn('full-stack.int-spec: skipped, no Python venv at .venv (see README "Python environment")');

const RUN = `${Date.now()}`;
const TOKEN = randomBytes(24).toString('hex');
const APP_SECRET = 'full-stack-app-secret';
const PHONE_ID = `9${RUN}`;
const prisma = new PrismaClient({ datasources: { db: { url: getTestDatabaseUrl() } } });

let tmp: string;
let aiProcess: ChildProcess;
let aiLog = '';
let graph: Server;
const graphSends: { to: string; text: string }[] = [];
let app: INestApplication;
let base: string;
let jwt: string;
let training: { syncActive: () => Promise<void> };
let sender: { processDue: () => Promise<number> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms: number, every = 500): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}\n--- AI service log ---\n${aiLog.slice(-3000)}`);
    await sleep(every);
  }
}

async function api<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${jwt}`, ...init.headers },
  });
  const body = (await res.json()) as { success: boolean; data: T; error?: { message: string } };
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${body.error?.message}`);
  return body.data;
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createNetServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

function webhook(value: object) {
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: PHONE_ID }, ...value } }] }] });
  return fetch(`${base}/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}` },
    body: raw,
  });
}

let seq = 0;
async function customerSays(text: string, from: string) {
  const id = `wamid.FS-${RUN}-${++seq}`;
  const res = await webhook({ contacts: [{ wa_id: from, profile: { name: 'Full Stack' } }], messages: [{ id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] });
  expect(res.status).toBe(200);
  const inbound = await until('the inbound message', () => prisma.message.findUnique({ where: { waMessageId: id } }), 10_000, 100);
  return until('the AI decision', () => prisma.aIDecision.findUnique({ where: { inboundMessageId: inbound.id } }), 30_000, 200);
}

suite('full stack: real AI service + backend + database', () => {
  let versionId: string;

  beforeAll(async () => {
    // A temporary checkpoint/dataset area and a tiny preset, so training takes seconds.
    tmp = mkdtempSync(join(tmpdir(), 'myownai-fullstack-'));
    const presets = join(tmp, 'presets');
    mkdirSync(presets);
    const config = JSON.parse(readFileSync(join(REPO_ROOT, 'ai-model', 'config', 'tiny-cpu.json'), 'utf8')) as Record<string, Record<string, unknown>>;
    config.dataset.synthetic_conversations = 400;
    config.tokenizer.vocab_size = 400;
    Object.assign(config.model, { context_length: 64, n_embd: 32, n_head: 2, n_layer: 1, dropout: 0 });
    Object.assign(config.training, { batch_size: 8, max_steps: 60, warmup_steps: 5, log_interval: 10, eval_interval: 20, eval_batches: 2, checkpoint_interval: 20, early_stop_patience: 0, num_threads: 1 });
    writeFileSync(join(presets, 'tiny-cpu.json'), JSON.stringify(config));

    const port = await freePort();
    aiProcess = spawn(PYTHON!, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(port)], {
      cwd: join(REPO_ROOT, 'apps', 'ai-service'),
      env: {
        ...process.env,
        AI_SERVICE_TOKEN: TOKEN,
        CHECKPOINT_DIR: join(tmp, 'checkpoints'),
        DATASET_DIR: join(tmp, 'uploads'),
        TRAINING_PRESETS_DIR: presets,
        AI_MODEL_CHECKPOINT: 'none/none.pt', // start without a model; the test activates one
        AI_TORCH_THREADS: '1',
        PYTHONUTF8: '1',
      },
    });
    aiProcess.stdout?.on('data', (d: Buffer) => (aiLog += d.toString()));
    aiProcess.stderr?.on('data', (d: Buffer) => (aiLog += d.toString()));
    const aiUrl = `http://127.0.0.1:${port}`;
    await until('the AI service to start', () => fetch(`${aiUrl}/health`).then((r) => r.ok).catch(() => false), 90_000);

    graph = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      if (req.method === 'POST') {
        const body = JSON.parse(raw) as { to: string; text: { body: string } };
        graphSends.push({ to: body.to, text: body.text.body });
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ messages: [{ id: `wamid.OUT-${RUN}-${graphSends.length}` }] }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ display_phone_number: '+1', verified_name: 'x' }));
      }
    });
    await new Promise<void>((r) => graph.listen(0, '127.0.0.1', r));

    Object.assign(process.env, {
      DATABASE_URL: getTestDatabaseUrl(),
      AI_SERVICE_URL: aiUrl,
      AI_SERVICE_TOKEN: TOKEN,
      AI_REQUEST_TIMEOUT_MS: '60000',
      WHATSAPP_GRAPH_URL: `http://127.0.0.1:${(graph.address() as AddressInfo).port}`,
      WHATSAPP_SENDER_INTERVAL_MS: '0',
      TRAINING_POLL_INTERVAL_MS: '0',
      CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      JWT_ACCESS_SECRET: 'f'.repeat(48),
    });
    const { AppModule } = await import('../src/app.module');
    const { TrainingService } = await import('../src/training/training.service');
    const { MessageSenderService } = await import('../src/whatsapp/message-sender.service');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true, logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`;
    training = app.get(TrainingService);
    sender = app.get(MessageSenderService);

    await seedDatabase(prisma);
    // No reset between runs: settle what earlier runs left, and use the default generation settings.
    await prisma.trainingJob.updateMany({ where: { status: { in: ['QUEUED', 'RUNNING', 'STOPPING'] } }, data: { status: 'FAILED' } });
    await prisma.trainingDataset.updateMany({ data: { isActive: false } });
    await prisma.systemSetting.deleteMany({ where: { key: 'ai.generation' } });
    await seedDatabase(prisma);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    const email = `fullstack-${RUN}@test.local`;
    await prisma.user.create({ data: { email, name: 'Full stack admin', passwordHash: await hashPassword('correct-horse-battery'), roleId: role.id } });
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-battery' }) });
    jwt = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (graph) await new Promise((r) => graph.close(r));
    if (aiProcess?.pid) {
      // The venv launcher starts a child Python; kill the whole tree.
      if (process.platform === 'win32') execSync(`taskkill /pid ${aiProcess.pid} /T /F`, { stdio: 'ignore' });
      else aiProcess.kill('SIGTERM');
    }
    await prisma.$disconnect();
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }, 60_000);

  it('reviews a dataset and trains a model from scratch on it', async () => {
    const lines = [
      { messages: [{ role: 'customer', text: `Do you do teeth whitening? ${RUN}` }, { role: 'assistant', text: 'Sorry, we do not offer teeth whitening.' }] },
      { messages: [{ role: 'customer', text: 'Can I bring my dog? Call 555 123 4567' }, { role: 'assistant', text: 'Sorry, only assistance dogs are allowed inside.' }] },
    ];
    const form = new FormData();
    form.set('file', new Blob([lines.map((l) => JSON.stringify(l)).join('\n')]), 'fullstack.jsonl');
    form.set('name', `fullstack-${RUN}`);
    const ds = await api<{ id: string; status: string }>('/datasets', { method: 'POST', body: form });
    expect(ds.status).toBe('VALID');
    const preview = await api<{ items: { messages: { text: string }[] }[] }>(`/datasets/${ds.id}/preview`);
    expect(JSON.stringify(preview)).toContain('Call <phone>'); // masked by the real cleaning code
    await api(`/datasets/${ds.id}/approve`, { method: 'POST', body: '{}' });
    await api(`/datasets/${ds.id}/activate`, { method: 'POST' });

    const job = await api<{ id: string; runName: string }>('/training/jobs', { method: 'POST', body: JSON.stringify({ preset: 'tiny-cpu' }) });
    const done = await until(
      'training to finish',
      async () => {
        await training.syncActive();
        const j = await prisma.trainingJob.findUniqueOrThrow({ where: { id: job.id }, include: { modelVersion: true } });
        return ['COMPLETED', 'STOPPED', 'FAILED'].includes(j.status) ? j : null;
      },
      240_000,
      1000,
    );
    expect({ status: done.status, error: done.errorMessage }).toEqual({ status: 'COMPLETED', error: null });
    expect(done.currentStep).toBe(60);
    expect(done.device).toBe('cpu');
    expect(done.modelVersion).toMatchObject({ status: 'READY', checkpointPath: `${job.runName}/best.pt` });
    const metrics = await api<{ step: number; valLoss: number | null }[]>(`/training/jobs/${job.id}/metrics`);
    expect(metrics.length).toBeGreaterThanOrEqual(6);
    expect(metrics.filter((m) => m.valLoss !== null).map((m) => m.step)).toEqual([20, 40, 60]);
    versionId = done.modelVersion!.id;
  }, 300_000);

  it('evaluates the new version and activates it in the AI service', async () => {
    await api(`/models/versions/${versionId}/evaluate`, { method: 'POST' });
    const ev = await until(
      'the evaluation',
      async () => {
        const e = await api<{ state: string; report: { validation: { loss: number; uniform_baseline_loss: number } } | null }>(`/models/versions/${versionId}/evaluation`);
        return e.state === 'running' ? null : e;
      },
      180_000,
      1000,
    );
    expect(ev.state).toBe('completed');
    // 60 steps learns something: well below an untrained model's loss.
    expect(ev.report!.validation.loss).toBeLessThan(ev.report!.validation.uniform_baseline_loss);

    await api(`/models/versions/${versionId}/activate`, { method: 'POST' });
    const status = await api<{ loaded: boolean; inSync: boolean; activeVersion: { id: string } }>('/ai/status');
    expect(status).toMatchObject({ loaded: true, inSync: true, activeVersion: { id: versionId } });
  }, 240_000);

  it('answers customers through WhatsApp with the new model and the guardrails', async () => {
    await api('/whatsapp/accounts', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Full stack clinic', phoneNumber: '+15550100000', phoneNumberId: PHONE_ID, businessAccountId: '20000000002', accessToken: 'EAAG-fullstack-access-token', appSecret: APP_SECRET, verifyToken: 'verify-fullstack-123', autoReplyEnabled: false }),
    });

    // An emergency never reaches the model, and is sent at once even with auto-reply off.
    const emergency = await customerSays('My father collapsed and is not breathing', '15557000001');
    expect(emergency).toMatchObject({ action: 'HANDOFF', reason: 'emergency', status: 'QUEUED', modelVersionId: versionId });
    await sender.processDue();
    const urgent = await until('the emergency reply to be sent', async () => graphSends.find((s) => s.to === '15557000001'), 15_000, 100);
    expect(urgent.text).toMatch(/emergency|112|911|ambulance/i);

    // A normal question goes to the real model; with auto-reply off it waits as a suggestion.
    const question = await customerSays('What are your opening hours?', '15557000002');
    expect(question).toMatchObject({ status: 'SUGGESTED', modelVersionId: versionId });
    expect(['REPLY', 'FALLBACK']).toContain(question.action);
    const usage = await prisma.aIUsage.findFirstOrThrow({ where: { conversationId: question.conversationId }, orderBy: { createdAt: 'desc' } });
    expect(usage.inputTokens).toBeGreaterThan(0);

    // Staff approve it; the sender delivers it, and a delivery receipt updates the message.
    await api(`/ai/decisions/${question.id}/approve`, { method: 'POST', body: '{}' });
    await sender.processDue();
    // Approving also kicks the sender in the background, so wait for whichever pass sends it.
    const sent = await until('the approved reply to be sent', async () => graphSends.find((s) => s.to === '15557000002'), 15_000, 100);
    expect(sent.text).toBe(question.text);
    const out = await until('the reply to be marked sent', () => prisma.message.findFirst({ where: { aiReplyToId: question.inboundMessageId, status: 'SENT' } }), 10_000, 100);
    await webhook({ statuses: [{ id: out.waMessageId, status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000) + 1), recipient_id: '15557000002' }] });
    await until('the delivery receipt', () => prisma.message.findFirst({ where: { id: out.id, status: 'DELIVERED' } }), 10_000, 100);
  }, 120_000);
});
