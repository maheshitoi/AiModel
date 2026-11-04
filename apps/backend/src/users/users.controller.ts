import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, requestMeta } from '../common/auth.types';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { Paginated } from '../common/pagination';
import { Permission } from '../common/permissions';
import { CreateUserDto, UpdateUserDto, UserQueryDto } from './users.dto';
import { PublicUser, UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@RequirePermissions(Permission.UsersManage)
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  list(@Query() q: UserQueryDto): Promise<Paginated<PublicUser>> {
    return this.users.list(q);
  }

  @Post('users')
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthUser, @Req() req: Request): Promise<PublicUser> {
    return this.users.create(dto, actor, requestMeta(req));
  }

  @Patch('users/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<PublicUser> {
    return this.users.update(id, dto, actor, requestMeta(req));
  }

  @Get('users/:id/sessions')
  sessions(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.sessions(id);
  }

  @Get('roles')
  roles() {
    return this.users.roles();
  }
}
