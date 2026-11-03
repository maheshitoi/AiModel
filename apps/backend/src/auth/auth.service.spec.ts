import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { AuditService } from '../logs/audit.service';
import { SystemLogService } from '../logs/system-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { SETTING_DEFAULTS } from '../settings/settings.defaults';
import { SettingsService } from '../settings/settings.service';
import { AuthService } from './auth.service';
import { hashPassword } from './password';

const SESSION_ID = '0196f2a0-0000-7000-8000-000000000001';
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

describe('AuthService', () => {
  let passwordHash: string;
  let prisma: { user: Record<string, jest.Mock>; session: Record<string, jest.Mock>; $transaction: jest.Mock };
  let systemLog: { warn: jest.Mock };
  let service: AuthService;

  const user = (overrides = {}) => ({
    id: 'user-1',
    email: 'admin@example.com',
    name: 'Admin',
    passwordHash,
    isActive: true,
    failedLoginCount: 0,
    lockedUntil: null,
    role: { name: 'ADMIN', permissions: ['*'] },
    ...overrides,
  });

  beforeAll(async () => {
    passwordHash = await hashPassword('correct horse battery');
  });

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn(), findUniqueOrThrow: jest.fn() },
      session: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    systemLog = { warn: jest.fn() };
    const settings = { get: jest.fn((key: 'security') => SETTING_DEFAULTS[key].value) };
    service = new AuthService(
      prisma as unknown as PrismaService,
      new JwtService({ secret: 'x'.repeat(32) }),
      settings as unknown as SettingsService,
      { record: jest.fn() } as unknown as AuditService,
      systemLog as unknown as SystemLogService,
    );
  });

  describe('login', () => {
    it('issues tokens and a hashed refresh token on valid credentials', async () => {
      prisma.user.findUnique.mockResolvedValue(user());

      const result = await service.login({ email: ' Admin@Example.com ', password: 'correct horse battery' }, {});

      expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'admin@example.com' } }));
      expect(result.accessToken).toBeDefined();
      expect(result.user).toEqual({ id: 'user-1', email: 'admin@example.com', name: 'Admin', role: 'ADMIN', permissions: ['*'] });
      const stored = prisma.session.create.mock.calls[0][0].data;
      expect(stored.refreshTokenHash).toBe(sha256(result.refreshToken));
      expect(result.refreshToken.startsWith(`${stored.id}.`)).toBe(true);
    });

    it('rejects unknown emails with the same generic message', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login({ email: 'nobody@example.com', password: 'whatever' }, {})).rejects.toThrow(
        'Invalid email or password',
      );
    });

    it('counts failed attempts and locks the account at the configured limit', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ failedLoginCount: 3 }));
      await expect(service.login({ email: 'admin@example.com', password: 'wrong' }, {})).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({ failedLoginCount: 4, lockedUntil: undefined });

      prisma.user.findUnique.mockResolvedValue(user({ failedLoginCount: 4 }));
      await expect(service.login({ email: 'admin@example.com', password: 'wrong' }, {})).rejects.toThrow(UnauthorizedException);
      const lockUpdate = prisma.user.update.mock.calls[1][0].data;
      expect(lockUpdate.failedLoginCount).toBe(0);
      expect(lockUpdate.lockedUntil).toBeInstanceOf(Date);
      expect(systemLog.warn).toHaveBeenLastCalledWith('SECURITY', 'auth.account_locked', expect.any(String), expect.any(Object));
    });

    it('refuses a locked account even with the right password', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ lockedUntil: new Date(Date.now() + 60_000) }));

      await expect(service.login({ email: 'admin@example.com', password: 'correct horse battery' }, {})).rejects.toThrow(
        /locked/,
      );
      expect(prisma.session.create).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const session = (token: string, overrides = {}) => ({
      id: SESSION_ID,
      userId: 'user-1',
      refreshTokenHash: sha256(token),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      user: user(),
      ...overrides,
    });

    it('rotates the refresh token', async () => {
      const token = `${SESSION_ID}.secret-1`;
      prisma.session.findUnique.mockResolvedValue(session(token));
      prisma.session.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.refresh(token);

      expect(result.refreshToken).not.toBe(token);
      expect(prisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SESSION_ID, refreshTokenHash: sha256(token), revokedAt: null },
          data: expect.objectContaining({ refreshTokenHash: sha256(result.refreshToken) }),
        }),
      );
    });

    it('revokes the session when an already-rotated token is reused', async () => {
      prisma.session.findUnique.mockResolvedValue(session(`${SESSION_ID}.current-secret`));

      await expect(service.refresh(`${SESSION_ID}.old-secret`)).rejects.toThrow('Session revoked');
      expect(prisma.session.update).toHaveBeenCalledWith({ where: { id: SESSION_ID }, data: { revokedAt: expect.any(Date) } });
      expect(systemLog.warn).toHaveBeenCalledWith('SECURITY', 'auth.refresh_reuse_detected', expect.any(String), expect.any(Object));
    });

    it('rejects malformed tokens without touching the database', async () => {
      await expect(service.refresh('not-a-token')).rejects.toThrow(UnauthorizedException);
      await expect(service.refresh(undefined)).rejects.toThrow(UnauthorizedException);
      expect(prisma.session.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('authenticate', () => {
    it('rejects a valid JWT whose session has been revoked', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      const { accessToken } = await service.login({ email: 'admin@example.com', password: 'correct horse battery' }, {});
      const sid = prisma.session.create.mock.calls[0][0].data.id;
      prisma.session.findUnique.mockResolvedValue({
        id: sid,
        userId: 'user-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        user: user(),
      });

      await expect(service.authenticate(accessToken)).rejects.toThrow('Session expired');
    });

    it('rejects tampered tokens', async () => {
      await expect(service.authenticate('eyJhbGciOiJIUzI1NiJ9.e30.bad')).rejects.toThrow('Invalid or expired access token');
    });
  });
});
