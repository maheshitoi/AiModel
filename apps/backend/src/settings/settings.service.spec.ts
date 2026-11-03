import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/auth.types';
import { AuditService } from '../logs/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SETTING_DEFAULTS } from './settings.defaults';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  const actor = { id: 'admin-1' } as AuthUser;
  let prisma: {
    systemSetting: Record<string, jest.Mock>;
    modelVersion: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let service: SettingsService;

  beforeEach(() => {
    prisma = {
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(({ create }) => ({ ...create, updatedAt: new Date() })),
      },
      modelVersion: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    service = new SettingsService(prisma as unknown as PrismaService, { record: jest.fn() } as unknown as AuditService);
  });

  it('falls back to defaults when nothing is stored', async () => {
    await expect(service.get('security')).resolves.toEqual(SETTING_DEFAULTS.security.value);
  });

  it('merges a partial patch over the current value', async () => {
    const result = await service.update('ai.generation', { temperature: 0.5 }, actor, {});
    expect(result.value).toEqual({ ...SETTING_DEFAULTS['ai.generation'].value, temperature: 0.5 });
  });

  it('rejects out-of-range and unknown fields', async () => {
    await expect(service.update('ai.generation', { temperature: 5 }, actor, {})).rejects.toThrow(BadRequestException);
    await expect(service.update('ai.generation', { hack: true }, actor, {})).rejects.toThrow(BadRequestException);
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it("rejects a context length larger than the active model's", async () => {
    prisma.modelVersion.findFirst.mockResolvedValue({ contextLength: 128 });
    await expect(service.update('ai.generation', { maxContextTokens: 256 }, actor, {})).rejects.toThrow(BadRequestException);
  });

  it('rejects unknown setting keys', async () => {
    await expect(service.update('nope', {}, actor, {})).rejects.toThrow(NotFoundException);
  });

  it('invalidates the cache after an update', async () => {
    await service.get('system');
    await service.update('system', { timezone: 'Asia/Kolkata' }, actor, {});
    prisma.systemSetting.findUnique.mockResolvedValue({ value: { timezone: 'Asia/Kolkata', logRetentionDays: 90 } });
    await expect(service.get('system')).resolves.toEqual({ timezone: 'Asia/Kolkata', logRetentionDays: 90 });
  });
});
