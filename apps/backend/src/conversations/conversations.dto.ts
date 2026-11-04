import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConversationStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { Equals, IsBoolean, IsDate, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../common/pagination';

export const INBOX_FILTERS = ['all', 'attention', 'open', 'human', 'closed'] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export class ConversationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: INBOX_FILTERS, default: 'all', description: '"all" leaves out closed conversations' })
  @IsOptional()
  @IsIn(INBOX_FILTERS)
  filter: InboxFilter = 'all';

  @ApiPropertyOptional({ description: 'Customer name or phone number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;
}

export class MessageQueryDto {
  @ApiPropertyOptional({ description: 'Return messages older than this (ISO time), for "load earlier"' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  before?: Date;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}

export class UpdateConversationDto {
  @ApiPropertyOptional({ enum: ConversationStatus, description: 'HUMAN = staff take over (the AI stops answering); OPEN = hand back to the AI' })
  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'null unassigns' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  assignedToId?: string | null;

  @ApiPropertyOptional({ description: 'Only false: marks the issue as handled' })
  @IsOptional()
  @Equals(false)
  needsAttention?: false;
}

export class SendMessageDto {
  @ApiProperty()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(4096) // WhatsApp's text limit
  text: string;
}
