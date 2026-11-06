import { Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { AuthUser, requestMeta } from '../common/auth.types';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { Permission } from '../common/permissions';
import { AuditService } from '../logs/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiClientService } from './ai-client.service';
import { callAi } from './call-ai';
import { ModelRegistryService } from './model-registry.service';

/** Model versions: what was trained, how it scored, and which one answers customers. */
@ApiTags('models')
@ApiBearerAuth()
@Controller('models')
export class ModelsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClientService,
    private readonly registry: ModelRegistryService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(Permission.ModelsRead)
  list() {
    return this.prisma.aIModel.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        architecture: true,
        versions: {
          orderBy: { version: 'desc' },
          select: {
            id: true,
            version: true,
            status: true,
            isActive: true,
            parameterCount: true,
            vocabSize: true,
            contextLength: true,
            checkpointPath: true,
            evalMetrics: true,
            trainedAt: true,
            activatedAt: true,
            createdAt: true,
            trainingJob: { select: { id: true, status: true, runName: true, bestValLoss: true, currentStep: true, totalSteps: true, finishedAt: true } },
          },
        },
      },
    });
  }

  @Post('versions/:id/activate')
  @HttpCode(200)
  @RequirePermissions(Permission.ModelsManage)
  async activate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    const version = await this.version(id);
    return callAi(() => this.registry.activate(version.checkpointPath, actor, requestMeta(req)));
  }

  @Post('versions/:id/evaluate')
  @HttpCode(202)
  @RequirePermissions(Permission.ModelsManage)
  async evaluate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    const version = await this.version(id);
    const result = await callAi(() => this.ai.startEvaluation(version.checkpointPath));
    await this.audit.record({
      actorId: actor.id,
      action: 'model.evaluate',
      entityType: 'ModelVersion',
      entityId: id,
      after: { checkpointPath: version.checkpointPath },
      meta: requestMeta(req),
    });
    return result;
  }

  /** The evaluation state from the AI service. The summary of a finished report is saved on the version. */
  @Get('versions/:id/evaluation')
  @RequirePermissions(Permission.ModelsRead)
  async evaluation(@Param('id', ParseUUIDPipe) id: string) {
    const version = await this.version(id);
    const result = await callAi(() => this.ai.evaluation(version.checkpointPath));
    if (result.state === 'completed' && result.report) {
      const { cases: _cases, ...summary } = result.report;
      const stored = version.evalMetrics as { step?: number | null; overall_pass_rate?: number } | null;
      if (stored?.step !== summary.step || stored?.overall_pass_rate !== summary.overall_pass_rate) {
        await this.prisma.modelVersion.update({
          where: { id },
          data: { evalMetrics: { ...summary, evaluatedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue },
        });
      }
    }
    return result;
  }

  private async version(id: string) {
    const version = await this.prisma.modelVersion.findUnique({ where: { id }, select: { id: true, checkpointPath: true, evalMetrics: true } });
    if (!version?.checkpointPath) throw new NotFoundException('Model version not found');
    return { ...version, checkpointPath: version.checkpointPath };
  }
}
