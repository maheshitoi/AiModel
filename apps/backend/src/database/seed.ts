import { Prisma, PrismaClient } from '@prisma/client';
import { PASSWORD_MIN } from '../auth/dto/auth.dto';
import { hashPassword } from '../auth/password';
import { ROLE_PERMISSIONS } from '../common/permissions';
import { SETTING_DEFAULTS } from '../settings/settings.defaults';

export const DEFAULT_MODEL_NAME = 'my-own-gpt';

export interface SeedAdmin {
  email: string;
  password: string;
}

/**
 * Idempotent: safe to run repeatedly. Never overwrites settings changed by users.
 * The admin account is created only when the database has no users at all.
 */
export async function seedDatabase(prisma: PrismaClient, admin?: SeedAdmin): Promise<{ adminCreated: boolean }> {
  if (admin && admin.password.length < PASSWORD_MIN) {
    throw new Error(`SEED_ADMIN_PASSWORD must be at least ${PASSWORD_MIN} characters`);
  }
  const passwordHash = admin ? await hashPassword(admin.password) : undefined;

  return prisma.$transaction(async (tx) => {
    for (const [name, role] of Object.entries(ROLE_PERMISSIONS)) {
      await tx.role.upsert({ where: { name }, create: { name, ...role }, update: role });
    }
    for (const [key, setting] of Object.entries(SETTING_DEFAULTS)) {
      const data = { description: setting.description, value: setting.value as unknown as Prisma.InputJsonValue };
      await tx.systemSetting.upsert({ where: { key }, create: { key, ...data }, update: {} });
    }
    await tx.aIModel.upsert({
      where: { name: DEFAULT_MODEL_NAME },
      create: { name: DEFAULT_MODEL_NAME, description: 'GPT-style decoder trained from scratch' },
      update: {},
    });

    if (!admin || (await tx.user.count()) > 0) return { adminCreated: false };
    const adminRole = await tx.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    await tx.user.create({
      data: { email: admin.email.trim().toLowerCase(), name: 'Administrator', passwordHash: passwordHash!, roleId: adminRole.id },
    });
    return { adminCreated: true };
  });
}
