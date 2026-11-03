import { IsBoolean, IsInt, IsNumber, IsString, IsTimeZone, Max, MaxLength, Min } from 'class-validator';

export class AiGenerationSettingsDto {
  @IsString()
  @MaxLength(2000)
  systemInstructions: string;

  @IsInt()
  @Min(1)
  @Max(512)
  maxNewTokens: number;

  @IsNumber()
  @Min(0)
  @Max(2)
  temperature: number;

  /** 0 disables top-k filtering. */
  @IsInt()
  @Min(0)
  @Max(1000)
  topK: number;

  @IsNumber()
  @Min(0.01)
  @Max(1)
  topP: number;

  /** Must not exceed the active model's context length (checked in SettingsService). */
  @IsInt()
  @Min(16)
  @Max(4096)
  maxContextTokens: number;

  @IsString()
  @MaxLength(1000)
  fallbackReply: string;
}

export class NotificationSettingsDto {
  @IsBoolean()
  trainingFinished: boolean;

  @IsBoolean()
  deliveryFailures: boolean;

  @IsBoolean()
  aiErrors: boolean;

  @IsBoolean()
  webhookErrors: boolean;
}

export class SystemSettingsDto {
  @IsTimeZone()
  timezone: string;

  @IsInt()
  @Min(1)
  @Max(3650)
  logRetentionDays: number;
}

export class SecuritySettingsDto {
  @IsInt()
  @Min(5)
  @Max(1440)
  accessTokenTtlMinutes: number;

  @IsInt()
  @Min(1)
  @Max(90)
  refreshTokenTtlDays: number;

  @IsInt()
  @Min(3)
  @Max(20)
  maxFailedLogins: number;
}

export const SETTING_SCHEMAS = {
  'ai.generation': AiGenerationSettingsDto,
  notifications: NotificationSettingsDto,
  system: SystemSettingsDto,
  security: SecuritySettingsDto,
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = InstanceType<(typeof SETTING_SCHEMAS)[K]>;

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTING_SCHEMAS, key);
}
