import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthUser, requestMeta } from '../common/auth.types';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { Permission } from '../common/permissions';
import { DatasetsService, type UploadedFile as DatasetFile } from './datasets.service';
import { ApproveDatasetDto, DatasetQueryDto, ExportConversationsDto, PreviewQueryDto, UploadDatasetDto } from './training.dto';

export const MAX_DATASET_BYTES = 20 * 1024 * 1024;

@ApiTags('datasets')
@ApiBearerAuth()
@Controller('datasets')
export class DatasetsController {
  constructor(private readonly datasets: DatasetsService) {}

  @Get()
  @RequirePermissions(Permission.DatasetsRead)
  list(@Query() q: DatasetQueryDto) {
    return this.datasets.list(q);
  }

  @Get(':id')
  @RequirePermissions(Permission.DatasetsRead)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.datasets.get(id);
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(Permission.DatasetsManage)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DATASET_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'file (.json, .jsonl or .txt, max 20 MB), name, description?, containsCustomerData?' })
  upload(@UploadedFile() file: DatasetFile | undefined, @Body() dto: UploadDatasetDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.datasets.upload(file, dto, actor, requestMeta(req));
  }

  @Post('from-conversations')
  @RequirePermissions(Permission.DatasetsManage, Permission.ConversationsRead)
  exportConversations(@Body() dto: ExportConversationsDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.datasets.exportConversations(dto, actor, requestMeta(req));
  }

  @Get(':id/preview')
  @RequirePermissions(Permission.DatasetsRead)
  preview(@Param('id', ParseUUIDPipe) id: string, @Query() q: PreviewQueryDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.datasets.preview(id, q.offset, q.limit, actor, requestMeta(req));
  }

  @Post(':id/validate')
  @HttpCode(200)
  @RequirePermissions(Permission.DatasetsManage)
  validate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.datasets.validate(id, actor, requestMeta(req));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions(Permission.DatasetsManage)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveDatasetDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.datasets.approve(id, dto, actor, requestMeta(req));
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions(Permission.DatasetsManage)
  activate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.datasets.setActive(id, true, actor, requestMeta(req));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions(Permission.DatasetsManage)
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.datasets.setActive(id, false, actor, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(Permission.DatasetsManage)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.datasets.remove(id, actor, requestMeta(req));
  }
}
