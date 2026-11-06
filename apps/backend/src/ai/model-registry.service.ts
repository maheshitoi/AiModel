import { ConflictException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ModelVersionStatus, Prisma } from '@prisma/client';
import type { AuthUser, RequestMeta } from '../common/auth.types';
import { DEFAULT_MODEL_NAME } from '../database/seed';
import { AuditService } from '../logs/audit.service';
import { SystemLogService } from '../logs/system-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiClientService, AiModelInfo } from './ai-client.service';

export interface VersionFields {
  checkpoint: string;
  parameters: number;
  vocabSize: number;
  contextLength: number;
  config: Prisma.InputJsonValue;
  status: ModelVersionStatus;
  trainedAt?: Date;
}

/**
 * Keeps ModelVersion rows in step with what the AI service has loaded.
 * The database's active version is the source of truth: the AI service loads it on activation, and
 * again if it restarts with a different model.
 */
@Injectable()
export class ModelRegistryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ModelRegistryService.name);
  private readonly versionIds = new Map<string, string>(); // checkpoint → ModelVersion id
  private syncing: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClientService,
    private readonly audit: AuditService,
    private readonly logs: SystemLogService,
  ) {}

  onApplicationBootstrap(): void {
    // Don't hold up startup: the AI service may still be starting too.
    void this.ensureActiveLoaded();
  }

  /** The ModelVersion for a checkpoint the AI service reported, created on first sight. */
  async versionFor(info: AiModelInfo): Promise<string> {
    const cached = this.versionIds.get(info.checkpoint);
    if (cached) return cached;
    const existing = await this.prisma.modelVersion.findUnique({ where: { checkpointPath: info.checkpoint } });
    const id =
      existing?.id ??
      (await this.register({
        checkpoint: info.checkpoint,
        parameters: info.parameters,
        vocabSize: info.vocab_size,
        contextLength: info.context_length,
        config: info as unknown as Prisma.InputJsonValue,
        status: 'READY',
      }));
    this.versionIds.set(info.checkpoint, id);
    return id;
  }

  async activate(checkpoint: string, actor: AuthUser, meta: RequestMeta) {
    const known = await this.prisma.modelVersion.findUnique({ where: { checkpointPath: checkpoint }, select: { status: true } });
    if (known && known.status !== 'READY') {
      throw new ConflictException(known.status === 'TRAINING' ? 'This version is still training' : `This version is ${known.status.toLowerCase()} and can't be activated`);
    }
    const info = await this.ai.loadModel(checkpoint);
    const versionId = await this.versionFor(info);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.modelVersion.findFirst({ where: { isActive: true }, select: { id: true, checkpointPath: true } });
      await tx.modelVersion.updateMany({ where: { isActive: true, id: { not: versionId } }, data: { isActive: false } });
      const version = await tx.modelVersion.update({ where: { id: versionId }, data: { isActive: true, activatedAt: new Date() } });
      await this.audit.record(
        { actorId: actor.id, action: 'model.activate', entityType: 'ModelVersion', entityId: versionId, before, after: { checkpointPath: checkpoint }, meta },
        tx,
      );
      return version;
    });
  }

  /** Loads the database's active version into the AI service if it is serving something else. */
  ensureActiveLoaded(): Promise<void> {
    this.syncing ??= this.sync().finally(() => (this.syncing = null));
    return this.syncing;
  }

  private async sync(): Promise<void> {
    try {
      const active = await this.prisma.modelVersion.findFirst({ where: { isActive: true } });
      if (!active?.checkpointPath) return;
      const current = await this.ai.currentModel();
      if (current.model?.checkpoint === active.checkpointPath) return;
      await this.ai.loadModel(active.checkpointPath);
      await this.logs.info('AI', 'model.reloaded', `Loaded the active model ${active.checkpointPath} into the AI service`, {
        previous: current.model?.checkpoint ?? null,
      });
    } catch (error) {
      this.logger.warn(`Could not sync the active model with the AI service: ${(error as Error).message}`);
    }
  }

  /** The platform's single AIModel (versions and training jobs hang off it). */
  async defaultModelId(): Promise<string> {
    const model = await this.prisma.aIModel.upsert({
      where: { name: DEFAULT_MODEL_NAME },
      create: { name: DEFAULT_MODEL_NAME, description: 'GPT-style decoder trained from scratch' },
      update: {},
    });
    return model.id;
  }

  /** Creates a ModelVersion with the next version number (or returns the one already registered for the checkpoint). */
  async register(fields: VersionFields): Promise<string> {
    const modelId = await this.defaultModelId();
    for (let attempt = 0; ; attempt++) {
      try {
        const last = await this.prisma.modelVersion.findFirst({ where: { modelId }, orderBy: { version: 'desc' } });
        const created = await this.prisma.modelVersion.create({
          data: {
            modelId,
            version: (last?.version ?? 0) + 1,
            status: fields.status,
            config: fields.config,
            parameterCount: fields.parameters,
            vocabSize: fields.vocabSize,
            contextLength: fields.contextLength,
            checkpointPath: fields.checkpoint,
            tokenizerPath: `${fields.checkpoint.split('/').slice(0, -1).join('/')}/tokenizer.json`,
            trainedAt: fields.trainedAt,
          },
        });
        this.versionIds.set(fields.checkpoint, created.id);
        return created.id;
      } catch (error) {
        // Another request registered the same checkpoint, or took the next version number, first.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') || attempt >= 2) throw error;
        const again = await this.prisma.modelVersion.findUnique({ where: { checkpointPath: fields.checkpoint } });
        if (again) return again.id;
      }
    }
  }
}
