import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const REPO_ROOT = join(__dirname, '..', '..', '..');

// Returns TEST_DATABASE_URL, refusing anything that could be the development database.
export function getTestDatabaseUrl(): string {
  const envFile = join(REPO_ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  if (url === process.env.DATABASE_URL || !/test/i.test(new URL(url).pathname)) {
    throw new Error('TEST_DATABASE_URL must point at a dedicated database whose name contains "test"');
  }
  return url;
}
