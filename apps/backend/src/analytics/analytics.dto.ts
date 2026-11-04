import { ApiPropertyOptional } from '@nestjs/swagger';
import { MessageDirection, MessageSource, MessageStatus, MessageType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../common/pagination';

export const USAGE_RANGES = [7, 30, 90] as const;

export class UsageQueryDto {
  @ApiPropertyOptional({ enum: USAGE_RANGES, default: 30, description: 'Days, ending today (in the system timezone)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(USAGE_RANGES)
  days: (typeof USAGE_RANGES)[number] = 30;
}

export class MessageSearchDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MessageDirection })
  @IsOptional()
  @IsEnum(MessageDirection)
  direction?: MessageDirection;

  @ApiPropertyOptional({ enum: MessageSource })
  @IsOptional()
  @IsEnum(MessageSource)
  source?: MessageSource;

  @ApiPropertyOptional({ enum: MessageStatus })
  @IsOptional()
  @IsEnum(MessageStatus)
  status?: MessageStatus;

  @ApiPropertyOptional({ enum: MessageType })
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiPropertyOptional({ description: 'ISO date-time, inclusive' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date-time, inclusive' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Text in the message' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;
}
