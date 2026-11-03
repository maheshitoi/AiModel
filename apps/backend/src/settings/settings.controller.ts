import { Body, Controller, Get, NotFoundException, Param, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, requestMeta } from '../common/auth.types';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { Permission } from '../common/permissions';
import { isSettingKey } from './settings.dto';
import { SettingsService, SettingView } from './settings.service';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions(Permission.SettingsRead)
  list(): Promise<SettingView[]> {
    return this.settings.list();
  }

  @Get(':key')
  @RequirePermissions(Permission.SettingsRead)
  async get(@Param('key') key: string): Promise<unknown> {
    if (!isSettingKey(key)) throw new NotFoundException(`Unknown setting "${key}"`);
    return this.settings.get(key);
  }

  @Patch(':key')
  @RequirePermissions(Permission.SettingsManage)
  @ApiBody({ description: 'Partial setting value; merged over the current value', schema: { type: 'object' } })
  update(
    @Param('key') key: string,
    @Body() patch: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<SettingView> {
    return this.settings.update(key, patch, user, requestMeta(req));
  }
}
