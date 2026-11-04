import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, requestMeta } from '../common/auth.types';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { Permission } from '../common/permissions';
import { ConversationQueryDto, MessageQueryDto, SendMessageDto, UpdateConversationDto } from './conversations.dto';
import { ConversationsService } from './conversations.service';

@ApiTags('conversations')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @RequirePermissions(Permission.ConversationsRead)
  list(@Query() q: ConversationQueryDto) {
    return this.conversations.list(q);
  }

  @Get(':id')
  @RequirePermissions(Permission.ConversationsRead)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.get(id);
  }

  @Get(':id/messages')
  @RequirePermissions(Permission.ConversationsRead)
  messages(@Param('id', ParseUUIDPipe) id: string, @Query() q: MessageQueryDto) {
    return this.conversations.messages(id, q);
  }

  @Post(':id/read')
  @HttpCode(204)
  @RequirePermissions(Permission.ConversationsRead)
  markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.markRead(id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ConversationsManage)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConversationDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.conversations.update(id, dto, actor, requestMeta(req));
  }

  @Post(':id/messages')
  @RequirePermissions(Permission.ConversationsReply)
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.conversations.send(id, dto, actor, requestMeta(req));
  }

  @Post(':id/messages/:messageId/retry')
  @HttpCode(200)
  @RequirePermissions(Permission.ConversationsReply)
  retry(@Param('id', ParseUUIDPipe) id: string, @Param('messageId', ParseUUIDPipe) messageId: string, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.conversations.retry(id, messageId, actor, requestMeta(req));
  }
}
