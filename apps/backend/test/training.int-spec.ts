import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { io } from 'socket.io-client';
import { hashPassword } from '../src/auth/password';
import { seedDatabase } from '../src/database/seed';
import { getTestDatabaseUrl } from './test-database';

// ── fake AI service: dataset files, training jobs and evaluations ────────────
interface Seen {
  method: string;
  path: string;
  raw: string;
}
const aiCalls: Seen[] = [];
const files = new Map<string, string>();
const jobs = new Map<string, Record<string, unknown>>();
let evaluationState: 'none' | 'completed' = 'none';

function report(content: string) {
  const lines = content.split('\n').filter((l) => l.trim());
  const bad = lines.filter((l) => l.includes('BAD')).length;
  return {
    records: lines.length,
    valid_records: lines.length - bad,
    issue_count: bad,
    issues: bad ? [{ record: 1, message: 'turn 1: text is empty' }] : [],
    dropped_after_cleaning: 0,
    duplicates: 0,
    unique: lines.length - bad,
    train: lines.length - bad - 1,
    validation: 1,
    turns: 2 * lines.length,
    intents: { unlabelled: lines.length - bad },
    size_bytes: Buffer.byteLength(content),
    sha256: 'x'.repeat(64),
  };
}

const EVAL_REPORT = {
  step: 30,
  parameters: 1000,
  validation: { loss: 0.5, perplexity: 1.6, assistant_tokens: 100, uniform_baseline_loss: 6 },
  groups: { in_distribution: { passed: 1, total: 1, rate: 1 } },
  overall_pass_rate: 1,
  well_formed_rate: 1,
  verbatim_rate: 0,
  cases: [{ group: 'in_distribution', prompt: [], reply: 'hi', expected_any: ['hi'], passed: true, verbatim_from_training: false, notes: [] }],
};

function handle(method: string, url: URL, raw: string): { status: number; body?: unknown } {
  const p = url.pathname;
  let m: RegExpMatchArray | null;
  if (p === '/v1/models/current') return { status: 200, body: { loaded: false, model: null, last_load_error: null } };
  if (p === '/v1/models/load') {
    const checkpoint = (JSON.parse(raw) as { checkpoint: string }).checkpoint;
    return { status: 200, body: { name: 'run', checkpoint, parameters: 1000, context_length: 32, vocab_size: 300, step: 30, best_val_loss: 0.5, facts_source: 'run', business_name: 'x', loaded_at: 'x' } };
  }
  if ((m = p.match(/^\/v1\/datasets\/([\w-]+)(\/\w+)?$/))) {
    const [, id, action] = m;
    if (method === 'PUT') {
      files.set(id, raw);
      return { status: 200, body: report(raw) };
    }
    if (method === 'DELETE') return files.delete(id), { status: 204 };
    if (!files.has(id)) return { status: 404, body: { detail: 'Dataset file not found' } };
    if (action === '/validate') return { status: 200, body: report(files.get(id)!) };
    if (action === '/preview') return { status: 200, body: { total: 1, items: [{ messages: [{ role: 'customer', text: 'hi' }, { role: 'assistant', text: 'hello' }], source: 'x' }] } };
  }
  if (p === '/v1/training/presets') {
    return { status: 200, body: [{ name: 'tiny-cpu', description: 'test', model: {}, training: { max_steps: 30, device: 'auto' }, dataset: { synthetic_conversations: 10 }, tokenizer: { vocab_size: 300 } }] };
  }
  if (p === '/v1/training/jobs' && method === 'POST') {
    const body = JSON.parse(raw) as { job_id: string };
    const job = { job_id: body.job_id, run_name: `tiny-cpu-${body.job_id.slice(0, 8)}`, state: 'starting', step: 0, max_steps: 30, events: [], best_checkpoint: null };
    jobs.set(body.job_id, job);
    return { status: 201, body: job };
  }
  if ((m = p.match(/^\/v1\/training\/jobs\/([\w-]+)(\/stop)?$/))) {
    const job = jobs.get(m[1]);
    if (!job) return { status: 404, body: { detail: 'Training job not found' } };
    if (m[2]) job.state = 'stopping';
    const since = Number(url.searchParams.get('since_step') ?? 0);
    return { status: 200, body: { ...job, events: (job.events as { step: number }[]).filter((e) => e.step >= since) } };
  }
  if (p === '/v1/evaluations') {
    if (method === 'POST') return (evaluationState = 'completed'), { status: 202, body: { checkpoint: 'x', state: 'running', report: null, error: null } };
    return { status: 200, body: { checkpoint: url.searchParams.get('checkpoint'), state: evaluationState, report: evaluationState === 'completed' ? EVAL_REPORT : null, error: null } };
  }
  return { status: 404, body: { detail: 'Not found' } };
}

// ── app under test ───────────────────────────────────────────────────────────
const RUN = `${Date.now()}`;
const prisma = new PrismaClient({ datasources: { db: { url: getTestDatabaseUrl() } } });
let app: INestApplication;
let base: string;
let origin: string;
let ai: Server;
let training: { syncActive: () => Promise<void> };
let adminJwt: string;
let operatorJwt: string;
let viewerJwt: string;

async function login(role: string): Promise<string> {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const email = `train-${role.toLowerCase()}-${RUN}@test.local`;
  await prisma.user.create({ data: { email, name: `Train ${role}`, passwordHash: await hashPassword('correct-horse-battery'), roleId: roleRow.id } });
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-battery' }) });
  return ((await res.json()) as { data: { accessToken: string } }).data.accessToken;
}

async function api<T = Record<string, unknown>>(path: string, init: RequestInit = {}, jwt = adminJwt): Promise<{ status: number; data: T }> {
  const json = typeof init.body === 'string';
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${jwt}`, ...init.headers } });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as { data?: T }) : {};
  return { status: res.status, data: (body.data ?? body) as T };
}

function upload(name: string, fileName: string, content: string, extra: Record<string, string> = {}, jwt = adminJwt) {
  const form = new FormData();
  form.set('file', new Blob([content]), fileName);
  form.set('name', name);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return api<{ id: string; status: string; version: number; recordCount: number; stats: { train: number } }>('/datasets', { method: 'POST', body: form }, jwt);
}

const line = (q: string, a: string) => JSON.stringify({ messages: [{ role: 'customer', text: q }, { role: 'assistant', text: a }] });

beforeAll(async () => {
  ai = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url ?? '/', 'http://x');
    aiCalls.push({ method: req.method ?? '', path: url.pathname + url.search, raw });
    const reply = handle(req.method ?? '', url, raw);
    res.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(reply.body === undefined ? undefined : JSON.stringify(reply.body));
  });
  await new Promise<void>((r) => ai.listen(0, '127.0.0.1', r));
  Object.assign(process.env, {
    DATABASE_URL: getTestDatabaseUrl(),
    AI_SERVICE_URL: `http://127.0.0.1:${(ai.address() as AddressInfo).port}`,
    AI_SERVICE_TOKEN: 'x'.repeat(40),
    WHATSAPP_SENDER_INTERVAL_MS: '0',
    TRAINING_POLL_INTERVAL_MS: '0', // the test drives the sync
    CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    JWT_ACCESS_SECRET: 'j'.repeat(48),
  });
  const { AppModule } = await import('../src/app.module');
  const { TrainingService } = await import('../src/training/training.service');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  origin = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  base = `${origin}/api/v1`;
  training = app.get(TrainingService);

  await seedDatabase(prisma);
  // The suite runs without a database reset: settle anything an earlier, interrupted run left behind.
  await prisma.trainingJob.updateMany({ where: { status: { in: ['QUEUED', 'RUNNING', 'STOPPING'] } }, data: { status: 'FAILED' } });
  await prisma.trainingDataset.updateMany({ data: { isActive: false } });
  [adminJwt, operatorJwt, viewerJwt] = [await login('ADMIN'), await login('OPERATOR'), await login('VIEWER')];
});

afterAll(async () => {
  await app?.close();
  await new Promise((r) => ai.close(r));
  await prisma.$disconnect();
});

beforeEach(() => {
  aiCalls.length = 0;
});

describe('datasets', () => {
  it('uploads, validates and versions a file; the AI service stores the exact bytes', async () => {
    const content = `${line(`hours? ${RUN}`, 'We open at 9.')}\n${line('price?', '50 dollars.')}\n`;
    const first = await upload(`faq-${RUN}`, 'faq.jsonl', content);
    expect(first.status).toBe(201);
    expect(first.data).toMatchObject({ status: 'VALID', version: 1, recordCount: 2, stats: { train: 1 } });
    const put = aiCalls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe(`/v1/datasets/${first.data.id}?format=jsonl`);
    expect(put.raw).toBe(content);

    const second = await upload(`faq-${RUN}`, 'faq.txt', `Customer: hi ${RUN}\nAssistant: hello\n`);
    expect(second.data).toMatchObject({ version: 2, status: 'VALID' });
    // The same bytes again are refused.
    expect((await upload(`other-${RUN}`, 'again.jsonl', content)).status).toBe(409);
    expect((await upload(`faq-${RUN}`, 'faq.csv', 'a,b')).status).toBe(400);
    // Audit records the upload but never the content.
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'dataset.upload', entityId: first.data.id } });
    expect(JSON.stringify(audit)).not.toContain('We open at 9');
  });

  it('requires validation, approval and activation, in that order', async () => {
    const invalid = await upload(`bad-${RUN}`, 'bad.jsonl', `BAD ${RUN}\n${line('a', 'b')}`);
    expect(invalid.data.status).toBe('INVALID');
    expect((await api(`/datasets/${invalid.data.id}/approve`, { method: 'POST', body: '{}' })).status).toBe(409);

    const ok = await upload(`good-${RUN}`, 'good.jsonl', line(`q ${RUN}`, 'a'));
    expect((await api(`/datasets/${ok.data.id}/activate`, { method: 'POST' })).status).toBe(409); // not approved yet
    expect((await api(`/datasets/${ok.data.id}/approve`, { method: 'POST', body: '{}' })).data).toMatchObject({ status: 'APPROVED' });
    const active = await api(`/datasets/${ok.data.id}/activate`, { method: 'POST' });
    expect(active.data).toMatchObject({ isActive: true, approvedBy: { name: 'Train ADMIN' } });
    expect((await api(`/datasets/${ok.data.id}/deactivate`, { method: 'POST' })).data).toMatchObject({ isActive: false });
  });

  it('makes customer data an explicit review, and audits reading it', async () => {
    const ds = await upload(`chats-${RUN}`, 'chats.jsonl', line(`real ${RUN}`, 'reply'), { containsCustomerData: 'true' });
    expect((await api(`/datasets/${ds.data.id}/approve`, { method: 'POST', body: '{}' })).status).toBe(400);
    const preview = await api<{ total: number }>(`/datasets/${ds.data.id}/preview?limit=5`);
    expect(preview.data.total).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'dataset.preview', entityId: ds.data.id } })).toBe(1);
    expect((await api(`/datasets/${ds.data.id}/approve`, { method: 'POST', body: JSON.stringify({ reviewedCustomerData: true }) })).data).toMatchObject({ status: 'APPROVED' });
  });

  it('exports closed conversations as customer data, with only sent replies', async () => {
    const account = await prisma.whatsAppAccount.create({
      data: { displayName: 'T', phoneNumber: '+1', phoneNumberId: `ds-${RUN}`, businessAccountId: '1', accessTokenEncrypted: 'x', accessTokenLast4: 'x', appSecretEncrypted: 'x', verifyTokenEncrypted: 'x' },
    });
    const t = Date.now();
    const at = (s: number) => new Date(t + s * 1000);
    await prisma.conversation.create({
      data: {
        whatsAppAccountId: account.id,
        customerWaId: '1555',
        status: 'CLOSED',
        lastMessageAt: at(5),
        messages: {
          create: [
            { direction: 'INBOUND', source: 'CUSTOMER', body: `Hello ${RUN}`, status: 'RECEIVED', occurredAt: at(1) },
            { direction: 'INBOUND', source: 'CUSTOMER', body: 'Are you open?', status: 'RECEIVED', occurredAt: at(2) },
            { direction: 'OUTBOUND', source: 'AI', body: 'Never sent', status: 'FAILED', occurredAt: at(3) },
            { direction: 'OUTBOUND', source: 'HUMAN', body: 'Yes, 9 to 5.', status: 'READ', occurredAt: at(4) },
            { direction: 'INBOUND', source: 'CUSTOMER', body: 'Unanswered', status: 'RECEIVED', occurredAt: at(5) },
          ],
        },
      },
    });
    const res = await api<{ id: string; containsCustomerData: boolean; status: string }>('/datasets/from-conversations', {
      method: 'POST',
      body: JSON.stringify({ name: `export-${RUN}`, since: new Date(t).toISOString() }),
    });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ containsCustomerData: true, status: 'VALID' });
    const sent = files.get(res.data.id)!.trim().split('\n').map((l) => JSON.parse(l) as unknown);
    expect(sent).toEqual([
      { messages: [{ role: 'customer', text: `Hello ${RUN}\nAre you open?` }, { role: 'assistant', text: 'Yes, 9 to 5.' }], source: 'conversations' },
    ]);
  });

  it('enforces permissions', async () => {
    expect((await api('/datasets', {}, viewerJwt)).status).toBe(403);
    expect((await api('/datasets', {}, operatorJwt)).status).toBe(200);
    expect((await upload(`op-${RUN}`, 'x.txt', 'Customer: a\nAssistant: b', {}, operatorJwt)).status).toBe(403);
    expect((await api('/training/jobs', { method: 'POST', body: JSON.stringify({ preset: 'tiny-cpu' }) }, operatorJwt)).status).toBe(403);
  });
});

describe('training jobs', () => {
  let jobId: string;
  let datasetId: string;

  it('starts a job with the active, approved datasets only', async () => {
    await prisma.trainingDataset.updateMany({ data: { isActive: false } });
    expect((await api('/training/jobs', { method: 'POST', body: JSON.stringify({ preset: 'tiny-cpu', includeSynthetic: false }) })).status).toBe(409);
    const ds = await upload(`train-${RUN}`, 'train.jsonl', line(`t ${RUN}`, 'a'));
    datasetId = ds.data.id;
    await api(`/datasets/${datasetId}/approve`, { method: 'POST', body: '{}' });
    await api(`/datasets/${datasetId}/activate`, { method: 'POST' });

    const { status, data } = await api<{ id: string; status: string; runName: string; totalSteps: number; datasets: { id: string }[] }>('/training/jobs', {
      method: 'POST',
      body: JSON.stringify({ preset: 'tiny-cpu', maxSteps: 30 }),
    });
    expect(status).toBe(201);
    jobId = data.id;
    expect(data).toMatchObject({ status: 'QUEUED', totalSteps: 30, runName: `tiny-cpu-${jobId.slice(0, 8)}`, datasets: [{ id: datasetId }] });
    const sent = JSON.parse(aiCalls.find((c) => c.path === '/v1/training/jobs')!.raw) as Record<string, unknown>;
    expect(sent).toEqual({ job_id: jobId, preset: 'tiny-cpu', max_steps: 30, include_synthetic: true, dataset_ids: [datasetId] });
    expect((await api('/training/jobs', { method: 'POST', body: JSON.stringify({ preset: 'tiny-cpu' }) })).status).toBe(409);
    expect((await api<{ id: string }>('/training/jobs/current', {}, viewerJwt)).data.id).toBe(jobId);
  });

  it('mirrors progress and metrics, registers the version, and pushes id-only events', async () => {
    const socket = io(origin, { auth: { token: viewerJwt }, transports: ['websocket'], reconnection: false });
    await new Promise<void>((r) => socket.on('connect', () => r()));
    await new Promise((r) => setTimeout(r, 200));
    const events: unknown[] = [];
    socket.on('training', (e: unknown) => events.push(e));

    Object.assign(jobs.get(jobId)!, {
      state: 'running',
      step: 20,
      parameters: 1000,
      vocab_size: 300,
      context_length: 32,
      device: 'cpu',
      best_val_loss: 1.5,
      events: [
        { type: 'train', step: 10, epoch: 0.5, train_loss: 3, lr: 0.001, tokens_per_sec: 900, cpu_percent: 80, rss_mb: 300 },
        { type: 'train', step: 20, epoch: 1, train_loss: 2, lr: 0.0009, tokens_per_sec: 950, cpu_percent: 85, rss_mb: 310 },
        { type: 'eval', step: 20, train_loss: 1.9, val_loss: 1.5 },
      ],
    });
    await training.syncActive();
    await training.syncActive(); // re-reading the same events changes nothing
    const job = await prisma.trainingJob.findUniqueOrThrow({ where: { id: jobId }, include: { modelVersion: true, metrics: { orderBy: { step: 'asc' } } } });
    expect(job).toMatchObject({ status: 'RUNNING', currentStep: 20, currentEpoch: 1, bestValLoss: 1.5, device: 'cpu' });
    expect(job.metrics.map((m) => [m.step, m.trainLoss, m.valLoss, m.learningRate])).toEqual([
      [10, 3, null, 0.001],
      [20, 2, 1.5, 0.0009],
    ]);
    expect(job.modelVersion).toMatchObject({ status: 'TRAINING', checkpointPath: `tiny-cpu-${jobId.slice(0, 8)}/best.pt`, parameterCount: 1000 });
    // A version still training can't be activated.
    expect((await api(`/models/versions/${job.modelVersionId}/activate`, { method: 'POST' })).status).toBe(409);

    await new Promise((r) => setTimeout(r, 200));
    socket.close();
    expect(events).toContainEqual({ type: 'job.changed', jobId });
  });

  it('stops safely and finishes with a ready version', async () => {
    const stop = await api<{ status: string }>(`/training/jobs/${jobId}/stop`, { method: 'POST' });
    expect(stop.data.status).toBe('STOPPING');
    expect(aiCalls.some((c) => c.path === `/v1/training/jobs/${jobId}/stop`)).toBe(true);
    Object.assign(jobs.get(jobId)!, { state: 'stopped', best_checkpoint: `tiny-cpu-${jobId.slice(0, 8)}/best.pt` });
    await training.syncActive();
    const job = await prisma.trainingJob.findUniqueOrThrow({ where: { id: jobId }, include: { modelVersion: true } });
    expect(job.status).toBe('STOPPED');
    expect(job.finishedAt).not.toBeNull();
    expect(job.modelVersion).toMatchObject({ status: 'READY' });
    expect((await api(`/training/jobs/${jobId}/stop`, { method: 'POST' })).status).toBe(409);

    const metrics = await api<unknown[]>(`/training/jobs/${jobId}/metrics`, {}, viewerJwt);
    expect(metrics.data).toHaveLength(2);
    const activated = await api<{ isActive: boolean }>(`/models/versions/${job.modelVersionId}/activate`, { method: 'POST' });
    expect(activated.data.isActive).toBe(true);
  });

  it('evaluates a version and keeps the summary', async () => {
    const job = await prisma.trainingJob.findUniqueOrThrow({ where: { id: jobId } });
    expect((await api(`/models/versions/${job.modelVersionId}/evaluate`, { method: 'POST' })).status).toBe(202);
    const result = await api<{ state: string; report: { cases: unknown[] } }>(`/models/versions/${job.modelVersionId}/evaluation`);
    expect(result.data.state).toBe('completed');
    expect(result.data.report.cases).toHaveLength(1);
    const version = await prisma.modelVersion.findUniqueOrThrow({ where: { id: job.modelVersionId! } });
    expect(version.evalMetrics).toMatchObject({ overall_pass_rate: 1, validation: { loss: 0.5 } });
    expect(version.evalMetrics).not.toHaveProperty('cases');
    const models = await api<{ versions: { id: string; trainingJob: { id: string } | null }[] }[]>('/models', {}, viewerJwt);
    expect(models.data[0].versions.find((v) => v.id === job.modelVersionId)?.trainingJob?.id).toBe(jobId);
  });

  it('archives a dataset a job used instead of deleting it', async () => {
    const used = await api<{ archived: boolean }>(`/datasets/${datasetId}`, { method: 'DELETE' });
    expect(used.data).toEqual({ deleted: false, archived: true });
    expect(files.has(datasetId)).toBe(true);
    const unused = await upload(`tmp-${RUN}`, 'tmp.jsonl', line(`tmp ${RUN}`, 'x'));
    expect((await api(`/datasets/${unused.data.id}`, { method: 'DELETE' })).data).toEqual({ deleted: true, archived: false });
    expect(files.has(unused.data.id)).toBe(false);
    expect(await prisma.trainingDataset.count({ where: { id: unused.data.id } })).toBe(0);
  });

  it('marks a job failed when the AI service no longer knows it', async () => {
    const id = (await api<{ id: string }>('/training/jobs', { method: 'POST', body: JSON.stringify({ preset: 'tiny-cpu' }) })).data.id;
    jobs.delete(id);
    await training.syncActive();
    const job = await prisma.trainingJob.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe('FAILED');
    expect(job.errorMessage).toContain('no record');
  });
});
