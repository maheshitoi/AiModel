import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators';
import { Permission } from '../common/permissions';
import { MessageSearchDto, UsageQueryDto } from './analytics.dto';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('usage')
  @RequirePermissions(Permission.UsageRead)
  usage(@Query() q: UsageQueryDto) {
    return this.analytics.usage(q.days);
  }

  @Get('messages')
  @RequirePermissions(Permission.MessagesRead)
  messages(@Query() q: MessageSearchDto) {
    return this.analytics.messages(q);
  }
}
