import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AIDecisionStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsEnum, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { PaginationQueryDto } from '../common/pagination';

export class TestMessageDto {
  @ApiProperty({ enum: ['customer', 'assistant'] })
  @IsIn(['customer', 'assistant'])
  role: 'customer' | 'assistant';

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text: string;
}

export class AiTestDto {
  @ApiProperty({ type: [TestMessageDto], description: 'Oldest first; the last one must be from the customer' })
  @ValidateNested({ each: true })
  @Type(() => TestMessageDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  messages: TestMessageDto[];
}

export class ApproveDecisionDto {
  @ApiPropertyOptional({ description: 'Edited reply. If it differs from the suggestion, the message is recorded as written by you' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text?: string;
}

export class ActivateModelDto {
  @ApiProperty({ example: 'tiny-cpu-v1/best.pt', description: 'Relative to the AI service CHECKPOINT_DIR' })
  @IsString()
  @MaxLength(300)
  @Matches(/^[\w.-]+(\/[\w.-]+)*\.pt$/, { message: 'checkpoint must be a relative path to a .pt file' })
  checkpoint: string;
}

export class DecisionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AIDecisionStatus })
  @IsOptional()
  @IsEnum(AIDecisionStatus)
  status?: AIDecisionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}
