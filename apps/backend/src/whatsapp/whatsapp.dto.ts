import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateWhatsAppAccountDto {
  @ApiProperty({ example: 'Sunrise Wellness Clinic' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName: string;

  @ApiProperty({ example: '+15550102030', description: 'E.164, for display' })
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'phoneNumber must be in E.164 format, e.g. +15550102030' })
  phoneNumber: string;

  @ApiProperty({ description: 'Phone number ID from WhatsApp Manager / the Meta app dashboard' })
  @Matches(/^\d{5,30}$/, { message: 'phoneNumberId must be numeric' })
  phoneNumberId: string;

  @ApiProperty({ description: 'WhatsApp Business Account ID' })
  @Matches(/^\d{5,30}$/, { message: 'businessAccountId must be numeric' })
  businessAccountId: string;

  @ApiProperty({ description: 'Permanent (system user) access token. Stored encrypted, never returned' })
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  accessToken: string;

  @ApiProperty({ description: 'Meta app secret, used to verify webhook signatures. Stored encrypted' })
  @IsString()
  @MinLength(16)
  @MaxLength(200)
  appSecret: string;

  @ApiProperty({ description: 'Any random string; enter the same value in the Meta webhook settings. Stored encrypted' })
  @IsString()
  @MinLength(16)
  @MaxLength(200)
  verifyToken: string;

  @ApiPropertyOptional({ default: false, description: 'Send AI replies without staff approval' })
  @IsOptional()
  @IsBoolean()
  autoReplyEnabled?: boolean;
}

/** Omitted credentials are kept; there is no way to read them back. */
export class UpdateWhatsAppAccountDto extends PartialType(CreateWhatsAppAccountDto) {
  @ApiPropertyOptional({ description: 'false disables the account: nothing is sent and webhooks are ignored' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
