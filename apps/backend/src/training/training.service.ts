import { ConflictException, Injectable, Logger, NotFoundException, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TrainingJob, TrainingJobStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AiClientService, AiJobState, AiServiceError, AiTrainingJob } from '../ai/ai-client.service';
import { callAi } from '../ai/call-ai';
import { ModelRegistryService } from '../ai/model-registry.service';
import type { AuthUser, RequestMeta } from '../common/auth.types';
import { Paginated } from '../common/pagination';
import { AuditService } from '../logs/audit.service';
import { SystemLogService } from '../logs/system-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { StartTrainingDto, TrainingJobQueryDto } from './training.dto';

export const ACTIVE_JOB_STATUSES: TrainingJobStatus[] = ['QUEUED', 'RUNNING', 'STOPPING'];

const STATE_TO_STATUS: Record<AiJobState, TrainingJobStatus> = {
  starting: 'QUEUED',
  preparing: 'QUEUED', // building the dataset and tokenizer
  running: 'RUNNING',
  stopping: 'STOPPING',
  completed: 'COMPLETED',
  early_stopped: 'COMPLETED',
  stopped: 'STOPPED',
  interrupted: 'STOPPED',
  failed: 'FAILED',
};

const jobSelect = {
  id: true,
  status: true,
  runName: true,
  device: true,
  config: true,
  currentStep: true,
  totalSteps: true,
  currentEpoch: true,
  bestValLoss: true,
  errorMessage: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  updatedAt: true,
  startedBy: { select: { id: true, name: true } },
  modelVersion: { select: { id: true, version: true, status: true, checkpointPath: true, isActive: true, parameterCount: true } },
  datasets: { select: { id: true, name: true, version: true } },
} satisfies Prisma.TrainingJobSelect;

/**
 * Training jobs. The AI service runs them; this service records who started what with which data,
 * mirrors progress and metrics into the database (polling the running job), registers the model
 * version a job produces, and pushes "job changed" signals to the dashboard.
 */
@Injectable()
export class TrainingService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TrainingService.name);
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private unreachableLogged = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClientService,
    private readonly registry: ModelRegistryService,
    private readonly audit: AuditService,
    private readonly logs: SystemLogService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const interval = Number(this.config.get('TRAINING_POLL_INTERVAL_MS') ?? 3000);
    if (interval > 0) this.timer = setInterval(() => void this.syncActive(), interval);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  presets() {
    return callAi(() => this.ai.trainingPresets());
  }

  async list(q: TrainingJobQueryDto) {
    const where = { status: q.status };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.trainingJob.findMany({ where, select: jobSelect, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.pageSize }),
      this.prisma.trainingJob.count({ where }),
    ]);
    return new Paginated(items, total, q);
  }

  async get(id: string) {
    const job = await this.prisma.trainingJob.findUnique({ where: { id }, select: jobSelect });
    if (!job) throw new NotFoundException('Training job not found');
    return job;
  }

  current() {
    return this.prisma.trainingJob.findFirst({ where: { status: { in: ACTIVE_JOB_STATUSES } }, select: jobSelect, orderBy: { createdAt: 'desc' } });
  }

  async metrics(id: string) {
    await this.get(id);
    return this.prisma.trainingMetric.findMany({
      where: { jobId: id },
      orderBy: { step: 'asc' },
      select: { step: true, epoch: true, trainLoss: true, valLoss: true, learningRate: true, tokensPerSec: true, cpuPercent: true, memoryMb: true, createdAt: true },
    });
  }

  async start(dto: StartTrainingDto, actor: AuthUser, meta: RequestMeta) {
    const presets = await this.presets();
    const preset = presets.find((p) => p.name === dto.preset);
    if (!preset) throw new NotFoundException(`Unknown preset ${dto.preset}`);
    if (await this.current()) throw new ConflictException('A training job is already running');
    // Only reviewed data: approved and switched on in Datasets.
    const datasets = await this.prisma.trainingDataset.findMany({ where: { status: 'APPROVED', isActive: true }, select: { id: true, name: true, version: true } });
    if (datasets.length === 0 && !dto.includeSynthetic) throw new ConflictException('No active datasets: activate an approved dataset or include the synthetic data');

    const id = randomUUID();
    const config = { preset: dto.preset, maxSteps: dto.maxSteps ?? null, includeSynthetic: dto.includeSynthetic, presetConfig: preset } as unknown as Prisma.InputJsonValue;
    await this.prisma.trainingJob.create({
      data: {
        id,
        modelId: await this.registry.defaultModelId(),
        status: 'QUEUED',
        config,
        totalSteps: dto.maxSteps ?? preset.training.max_steps,
        startedById: actor.id,
        startedAt: new Date(),
        datasets: { connect: datasets.map((d) => ({ id: d.id })) },
      },
    });
    let started: AiTrainingJob;
    try {
      started = await callAi(() =>
        this.ai.startTraining({ job_id: id, preset: dto.preset, max_steps: dto.maxSteps, include_synthetic: dto.includeSynthetic, dataset_ids: datasets.map((d) => d.id) }),
      );
    } catch (error) {
      await this.prisma.trainingJob.update({ where: { id }, data: { status: 'FAILED', errorMessage: (error as Error).message, finishedAt: new Date() } });
      this.realtime.training(id);
      throw error;
    }
    await this.prisma.trainingJob.update({ where: { id }, data: { runName: started.run_name } });
    await this.audit.record({
      actorId: actor.id,
      action: 'training.start',
      entityType: 'TrainingJob',
      entityId: id,
      after: { preset: dto.preset, maxSteps: dto.maxSteps ?? null, includeSynthetic: dto.includeSynthetic, datasets: datasets.map((d) => `${d.name} v${d.version}`), runName: started.run_name },
      meta,
    });
    await this.logs.info('TRAINING', 'training.started', `Training job started (${dto.preset}, run ${started.run_name})`, { jobId: id, datasets: datasets.length });
    this.realtime.training(id);
    return this.get(id);
  }

  async stop(id: string, actor: AuthUser, meta: RequestMeta) {
    const job = await this.get(id);
    if (!ACTIVE_JOB_STATUSES.includes(job.status)) throw new ConflictException(`The job has already ${job.status === 'FAILED' ? 'failed' : 'finished'}`);
    await callAi(() => this.ai.stopTraining(id));
    if (job.status !== 'STOPPING') {
      await this.prisma.trainingJob.update({ where: { id }, data: { status: 'STOPPING' } });
      await this.audit.record({ actorId: actor.id, action: 'training.stop', entityType: 'TrainingJob', entityId: id, before: { status: job.status }, meta });
      this.realtime.training(id);
    }
    return this.get(id);
  }

  /** Mirrors every active job from the AI service. Called by the poller; safe to call at any time. */
  async syncActive(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const jobs = await this.prisma.trainingJob.findMany({ where: { status: { in: ACTIVE_JOB_STATUSES }, runName: { not: null } } });
      for (const job of jobs) await this.sync(job);
    } catch (error) {
      this.logger.error(`Training sync failed: ${(error as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  private async sync(job: TrainingJob): Promise<void> {
    const last = await this.prisma.trainingMetric.findFirst({ where: { jobId: job.id }, orderBy: { step: 'desc' }, select: { step: true, learningRate: true, epoch: true } });
    let remote: AiTrainingJob;
    try {
      remote = await this.ai.trainingJob(job.id, last?.step ?? 0);
      this.unreachableLogged = false;
    } catch (error) {
      if (error instanceof AiServiceError && error.kind === 'not_found') {
        await this.finish(job, { status: 'FAILED', errorMessage: 'The AI service has no record of this job (was its run directory deleted?)' });
        return;
      }
      if (!this.unreachableLogged) {
        this.unreachableLogged = true;
        await this.logs.warn('TRAINING', 'training.sync_failed', `Could not reach the AI service to update training progress: ${(error as Error).message}`, { jobId: job.id });
      }
      return;
    }

    // Upsert by step: re-reading the same events (or a resumed run logging a step again) is harmless.
    let lr = last?.learningRate ?? 0;
    let epoch = last?.epoch ?? 0;
    const writes: Prisma.PrismaPromise<unknown>[] = [];
    for (const e of remote.events) {
      const where = { jobId_step: { jobId: job.id, step: e.step } };
      if (e.type === 'train') {
        lr = e.lr ?? lr;
        epoch = e.epoch ?? epoch;
        const data = { epoch, trainLoss: e.train_loss, learningRate: lr, tokensPerSec: e.tokens_per_sec ?? null, cpuPercent: e.cpu_percent ?? null, memoryMb: e.rss_mb ?? null };
        writes.push(this.prisma.trainingMetric.upsert({ where, create: { jobId: job.id, step: e.step, ...data }, update: data }));
      } else {
        writes.push(
          this.prisma.trainingMetric.upsert({
            where,
            create: { jobId: job.id, step: e.step, epoch, trainLoss: e.train_loss, valLoss: e.val_loss ?? null, learningRate: lr },
            update: { valLoss: e.val_loss ?? null },
          }),
        );
      }
    }
    if (writes.length) await this.prisma.$transaction(writes);

    const status = STATE_TO_STATUS[remote.state];
    let modelVersionId = job.modelVersionId;
    if (!modelVersionId && remote.parameters && remote.vocab_size && remote.context_length) {
      // The model's shape is known once training starts: register the version it will produce.
      modelVersionId = await this.registry.register({
        checkpoint: `${remote.run_name}/best.pt`,
        parameters: remote.parameters,
        vocabSize: remote.vocab_size,
        contextLength: remote.context_length,
        config: { ...(job.config as Prisma.JsonObject), device: remote.device, dataset: remote.dataset, trainingJobId: job.id },
        status: 'TRAINING',
      });
    }
    const progress = {
      status: status === 'QUEUED' && job.status !== 'QUEUED' ? job.status : status,
      currentStep: remote.step,
      totalSteps: remote.max_steps ?? job.totalSteps,
      currentEpoch: epoch,
      bestValLoss: remote.best_val_loss,
      device: remote.device,
      modelVersionId,
    };
    if (ACTIVE_JOB_STATUSES.includes(status)) {
      const changed = writes.length > 0 || progress.status !== job.status || modelVersionId !== job.modelVersionId;
      await this.prisma.trainingJob.update({ where: { id: job.id }, data: progress });
      if (changed) this.realtime.training(job.id);
      return;
    }
    await this.finish({ ...job, modelVersionId }, { ...progress, status, errorMessage: remote.error }, remote.best_checkpoint !== null);
  }

  private async finish(job: TrainingJob, data: Prisma.TrainingJobUncheckedUpdateInput & { status: TrainingJobStatus }, hasCheckpoint = false): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.trainingJob.update({ where: { id: job.id }, data: { ...data, finishedAt: new Date() } });
      if (job.modelVersionId) {
        await tx.modelVersion.update({
          where: { id: job.modelVersionId },
          data: hasCheckpoint ? { status: 'READY', trainedAt: new Date(), evalMetrics: Prisma.DbNull } : { status: 'FAILED' },
        });
      }
    });
    const message = `Training job ${job.runName ?? job.id} ${data.status.toLowerCase()}${data.errorMessage ? `: ${String(data.errorMessage)}` : ''}`;
    if (data.status === 'FAILED') await this.logs.error('TRAINING', 'training.failed', message, { jobId: job.id });
    else await this.logs.info('TRAINING', 'training.finished', message, { jobId: job.id, bestValLoss: data.bestValLoss ?? null });
    this.realtime.training(job.id);
  }
}
