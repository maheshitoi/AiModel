import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, requestMeta } from '../common/auth.types';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { Permission } from '../common/permissions';
import { StartTrainingDto, TrainingJobQueryDto } from './training.dto';
import { TrainingService } from './training.service';

@ApiTags('training')
@ApiBearerAuth()
@Controller('training')
export class TrainingController {
  constructor(private readonly training: TrainingService) {}

  @Get('presets')
  @RequirePermissions(Permission.TrainingRead)
  presets() {
    return this.training.presets();
  }

  @Get('jobs')
  @RequirePermissions(Permission.TrainingRead)
  list(@Query() q: TrainingJobQueryDto) {
    return this.training.list(q);
  }

  /** The queued, running or stopping job, or null. */
  @Get('jobs/current')
  @RequirePermissions(Permission.TrainingRead)
  current() {
    return this.training.current();
  }

  @Get('jobs/:id')
  @RequirePermissions(Permission.TrainingRead)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.training.get(id);
  }

  @Get('jobs/:id/metrics')
  @RequirePermissions(Permission.TrainingRead)
  metrics(@Param('id', ParseUUIDPipe) id: string) {
    return this.training.metrics(id);
  }

  @Post('jobs')
  @RequirePermissions(Permission.TrainingManage)
  start(@Body() dto: StartTrainingDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.training.start(dto, actor, requestMeta(req));
  }

  @Post('jobs/:id/stop')
  @HttpCode(200)
  @RequirePermissions(Permission.TrainingManage)
  stop(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.training.stop(id, actor, requestMeta(req));
  }
}
