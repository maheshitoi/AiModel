import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthUser, requestMeta } from '../common/auth.types';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { Paginated } from '../common/pagination';
import { Permission } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { AiClientService, AiServiceError } from './ai-client.service';
import { AiReplyService } from './ai-reply.service';
import { ActivateModelDto, AiTestDto, ApproveDecisionDto, DecisionQueryDto } from './ai.dto';
import { ModelRegistryService } from './model-registry.service';

/** AI service failures become 503/502/4xx with the client's fixed messages, never upstream bodies. */
async function callAi<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof AiServiceError)) throw error;
    switch (error.kind) {
      case 'rejected':
        throw new BadRequestException(error.message);
      case 'not_found':
        throw new NotFoundException(error.message);
      case 'misconfigured':
      case 'bad_response':
        throw new BadGatewayException(error.message);
      default:
        throw new ServiceUnavailableException(error.message);
    }
  }
}

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiClientService,
    private readonly replies: AiReplyService,
    private readonly registry: ModelRegistryService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('status')
  @RequirePermissions(Permission.ModelsRead)
  async status() {
    const active = await this.prisma.modelVersion.findFirst({
      where: { isActive: true },
      select: { id: true, version: true, checkpointPath: true, activatedAt: true },
    });
    try {
      const current = await this.ai.currentModel();
      return {
        reachable: true,
        loaded: current.loaded,
        model: current.model,
        lastLoadError: current.last_load_error,
        activeVersion: active,
        inSync: !active || current.model?.checkpoint === active.checkpointPath,
      };
    } catch (error) {
      if (!(error instanceof AiServiceError)) throw error;
      return { reachable: false, error: error.message, loaded: false, model: null, lastLoadError: null, activeVersion: active, inSync: false };
    }
  }

  @Get('checkpoints')
  @RequirePermissions(Permission.ModelsRead)
  checkpoints() {
    return callAi(() => this.ai.checkpoints());
  }

  @Post('models/activate')
  @HttpCode(200)
  @RequirePermissions(Permission.ModelsManage)
  activate(@Body() dto: ActivateModelDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return callAi(() => this.registry.activate(dto.checkpoint, actor, requestMeta(req)));
  }

  @Post('test')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(Permission.ConversationsReply)
  test(@Body() dto: AiTestDto) {
    if (dto.messages[dto.messages.length - 1].role !== 'customer') {
      throw new BadRequestException('The last message must be from the customer');
    }
    return callAi(() => this.replies.test(dto.messages));
  }

  @Get('decisions')
  @RequirePermissions(Permission.ConversationsRead)
  async decisions(@Query() q: DecisionQueryDto) {
    const where = { status: q.status, conversationId: q.conversationId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.aIDecision.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.pageSize }),
      this.prisma.aIDecision.count({ where }),
    ]);
    return new Paginated(items, total, q);
  }

  @Post('decisions/:id/approve')
  @HttpCode(200)
  @RequirePermissions(Permission.ConversationsReply)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveDecisionDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.replies.approve(id, dto.text, actor, requestMeta(req));
  }

  @Post('decisions/:id/dismiss')
  @HttpCode(200)
  @RequirePermissions(Permission.ConversationsReply)
  dismiss(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.replies.dismiss(id, actor, requestMeta(req));
  }
}
