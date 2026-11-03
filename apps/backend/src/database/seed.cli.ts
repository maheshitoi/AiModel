import { PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { seedDatabase } from './seed';

async function main(): Promise<void> {
  // Local dev reads the root .env; in production DATABASE_URL comes from the environment.
  const envFile = join(__dirname, '..', '..', '..', '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const { SEED_ADMIN_EMAIL: email, SEED_ADMIN_PASSWORD: password } = process.env;
  const prisma = new PrismaClient();
  try {
    const { adminCreated } = await seedDatabase(prisma, email && password ? { email, password } : undefined);
    console.log('Seed completed: roles, default settings, base model record');
    console.log(adminCreated ? `Admin account created: ${email}` : 'Admin account: skipped (users already exist or SEED_ADMIN_* unset)');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
