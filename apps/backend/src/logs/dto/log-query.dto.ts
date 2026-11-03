import { ApiPropertyOptional } from '@nestjs/swagger';
import { LogCategory, LogLevel } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination';

class DateRangeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'ISO date-time, inclusive' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date-time, inclusive' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class SystemLogQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ enum: LogLevel })
  @IsOptional()
  @IsEnum(LogLevel)
  level?: LogLevel;

  @ApiPropertyOptional({ enum: LogCategory })
  @IsOptional()
  @IsEnum(LogCategory)
  category?: LogCategory;

  @ApiPropertyOptional({ description: 'Matches event name or message' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class AuditLogQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ example: 'settings.update' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ example: 'User' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityType?: string;
}

export function dateRange(q: DateRangeQueryDto): { gte?: Date; lte?: Date } | undefined {
  if (!q.from && !q.to) return undefined;
  return { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined };
}
