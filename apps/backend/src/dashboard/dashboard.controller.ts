import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { RequirePermissions } from '../common/decorators';
import { Permission } from '../common/permissions';
import { ChartRange, DashboardService, MessageChartPoint } from './dashboard.service';

class ChartQueryDto {
  @ApiPropertyOptional({ enum: ['daily', 'weekly', 'monthly'], default: 'daily' })
  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly'])
  range: ChartRange = 'daily';
}

@ApiTags('dashboard')
@ApiBearerAuth()
@RequirePermissions(Permission.DashboardRead)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  overview() {
    return this.dashboard.overview();
  }

  @Get('messages-chart')
  messagesChart(@Query() q: ChartQueryDto): Promise<MessageChartPoint[]> {
    return this.dashboard.messagesChart(q.range);
  }
}
