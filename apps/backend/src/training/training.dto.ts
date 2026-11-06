import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DatasetStatus, TrainingJobStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../common/pagination';

// Multipart fields arrive as strings.
const toBool = ({ value }: { value: unknown }) => value === true || value === 'true';

export class UploadDatasetDto {
  @ApiProperty({ example: 'clinic-faq', description: 'Uploading again under the same name creates the next version' })
  @IsString()
  @Matches(/^[\w .-]{1,80}$/, { message: 'name may contain letters, digits, spaces, dots, dashes and underscores (max 80)' })
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'The file contains real customer conversations (requires an explicit review before approval)' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  containsCustomerData: boolean = false;
}

export class ExportConversationsDto {
  @ApiProperty({ example: 'reviewed-chats' })
  @IsString()
  @Matches(/^[\w .-]{1,80}$/, { message: 'name may contain letters, digits, spaces, dots, dashes and underscores (max 80)' })
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ description: 'Conversations with messages on or after this time' })
  @IsDateString()
  since: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  until?: string;

  @ApiPropertyOptional({ default: true, description: 'Only closed conversations' })
  @IsOptional()
  @IsBoolean()
  closedOnly: boolean = true;

  @ApiPropertyOptional({ default: 500, maximum: 2000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2000)
  limit: number = 500;
}

export class ApproveDatasetDto {
  @ApiPropertyOptional({ description: 'Required for datasets with customer data: you read the preview and it is fit for training' })
  @IsOptional()
  @IsBoolean()
  reviewedCustomerData?: boolean;
}

export class DatasetQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DatasetStatus })
  @IsOptional()
  @IsEnum(DatasetStatus)
  status?: DatasetStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class PreviewQueryDto {
  @ApiPropertyOptional({ default: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class StartTrainingDto {
  @ApiProperty({ example: 'tiny-cpu', description: 'A preset from GET /training/presets' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  preset: string;

  @ApiPropertyOptional({ description: "Overrides the preset's step count" })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(1_000_000)
  maxSteps?: number;

  @ApiPropertyOptional({ default: true, description: 'Also train on the synthetic conversations generated from the business facts' })
  @IsOptional()
  @IsBoolean()
  includeSynthetic: boolean = true;
}

export class TrainingJobQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TrainingJobStatus })
  @IsOptional()
  @IsEnum(TrainingJobStatus)
  status?: TrainingJobStatus;
}
