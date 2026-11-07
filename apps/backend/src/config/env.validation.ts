import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  validateSync,
} from 'class-validator';
import { decodeKey } from '../common/credential-cipher';

@ValidatorConstraint({ name: 'aes256Key' })
class IsAes256Key implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && decodeKey(value) !== null;
  }
  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be 32 random bytes, base64-encoded`;
  }
}

class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

  @IsString()
  DATABASE_URL: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  BACKEND_PORT: number = 4000;

  /** Reverse proxies in front of the backend (1 behind Caddy), so client IPs and rate limits are right. */
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY: number = 0;

  /** Serve the Swagger UI at /api/docs. Off in production unless set to true. */
  @IsIn(['true', 'false', ''])
  SWAGGER_ENABLED: string = '';

  @IsString()
  CORS_ORIGINS: string = 'http://localhost:3000';

  @IsUrl({ require_tld: false })
  AI_SERVICE_URL: string = 'http://localhost:8000';

  // Sent to the AI service as X-Internal-Token; must equal the AI service's own AI_SERVICE_TOKEN.
  @IsString()
  @MinLength(32)
  AI_SERVICE_TOKEN: string;

  @IsInt()
  @Min(1000)
  @Max(120_000)
  AI_REQUEST_TIMEOUT_MS: number = 15_000;

  // Encrypts WhatsApp credentials at rest. Changing it makes stored credentials unreadable.
  @Validate(IsAes256Key)
  CREDENTIALS_ENCRYPTION_KEY: string;

  @IsUrl({ require_tld: false })
  WHATSAPP_GRAPH_URL: string = 'https://graph.facebook.com';

  @Matches(/^v\d+\.\d+$/)
  WHATSAPP_GRAPH_VERSION: string = 'v23.0';

  /** How often the sender looks for queued outbound messages; 0 disables it. */
  @IsInt()
  @Min(0)
  @Max(60_000)
  WHATSAPP_SENDER_INTERVAL_MS: number = 2000;

  /** How often running training jobs are synced from the AI service; 0 disables it. */
  @IsInt()
  @Min(0)
  @Max(60_000)
  TRAINING_POLL_INTERVAL_MS: number = 3000;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;
}

export type AppEnv = EnvironmentVariables;

// Fails fast at boot if required configuration is missing or malformed.
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return env;
}
