import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser, RequestMeta } from '../common/auth.types';
import { DEFAULT_MODEL_NAME } from '../database/seed';
import { AuditService } from '../logs/audit.service';
import { SystemLogService } from '../logs/system-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiClientService, AiModelInfo } from './ai-client.service';

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
    const id = existing?.id ?? (await this.create(info));
    this.versionIds.set(info.checkpoint, id);
    return id;
  }

  async activate(checkpoint: string, actor: AuthUser, meta: RequestMeta) {
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

  private async create(info: AiModelInfo): Promise<string> {
    const model = await this.prisma.aIModel.upsert({
      where: { name: DEFAULT_MODEL_NAME },
      create: { name: DEFAULT_MODEL_NAME, description: 'GPT-style decoder trained from scratch' },
      update: {},
    });
    for (let attempt = 0; ; attempt++) {
      try {
        const last = await this.prisma.modelVersion.findFirst({ where: { modelId: model.id }, orderBy: { version: 'desc' } });
        const created = await this.prisma.modelVersion.create({
          data: {
            modelId: model.id,
            version: (last?.version ?? 0) + 1,
            status: 'READY',
            config: info as unknown as Prisma.InputJsonValue,
            parameterCount: info.parameters,
            vocabSize: info.vocab_size,
            contextLength: info.context_length,
            checkpointPath: info.checkpoint,
            tokenizerPath: `${info.checkpoint.split('/').slice(0, -1).join('/')}/tokenizer.json`,
          },
        });
        return created.id;
      } catch (error) {
        // Another request registered the same checkpoint, or took the next version number, first.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') || attempt >= 2) throw error;
        const again = await this.prisma.modelVersion.findUnique({ where: { checkpointPath: info.checkpoint } });
        if (again) return again.id;
      }
    }
  }
}
