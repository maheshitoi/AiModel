import { PrismaService } from '../prisma/prisma.service';
import { redact, SystemLogService } from './system-log.service';

describe('redact', () => {
  it('masks sensitive keys at any depth and keeps everything else', () => {
    expect(
      redact({
        userId: 'u1',
        password: 'p',
        nested: { accessToken: 't', items: [{ appSecret: 's', ok: 1 }] },
        Authorization: 'Bearer x',
      }),
    ).toEqual({
      userId: 'u1',
      password: '[REDACTED]',
      nested: { accessToken: '[REDACTED]', items: [{ appSecret: '[REDACTED]', ok: 1 }] },
      Authorization: '[REDACTED]',
    });
  });
});

describe('SystemLogService', () => {
  it('never throws when the database write fails', async () => {
    const prisma = { systemLog: { create: jest.fn().mockRejectedValue(new Error('db down')) } };
    const service = new SystemLogService(prisma as unknown as PrismaService);

    await expect(service.error('BACKEND', 'test.event', 'boom')).resolves.toBeUndefined();
  });
});
