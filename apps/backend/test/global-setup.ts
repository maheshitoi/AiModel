import { execSync } from 'node:child_process';
import { REPO_ROOT, getTestDatabaseUrl } from './test-database';

// Rebuild the test database from the committed migrations before the suite runs.
export default function globalSetup(): void {
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate --schema prisma/schema.prisma', {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: getTestDatabaseUrl() },
    stdio: 'pipe',
  });
}
