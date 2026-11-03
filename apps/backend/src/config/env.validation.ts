import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsString, IsUrl, Max, Min, MinLength, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

  @IsString()
  DATABASE_URL: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  BACKEND_PORT: number = 4000;

  @IsString()
  CORS_ORIGINS: string = 'http://localhost:3000';

  @IsUrl({ require_tld: false })
  AI_SERVICE_URL: string = 'http://localhost:8000';

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
