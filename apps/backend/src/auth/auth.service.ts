import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isUUID } from 'class-validator';
import type { AuthUser, RequestMeta } from '../common/auth.types';
import { AuditService } from '../logs/audit.service';
import { SystemLogService } from '../logs/system-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ChangePasswordDto, LoginDto } from './dto/auth.dto';
import { hashPassword, verifyPassword } from './password';

const LOCK_MINUTES = 15;
const INVALID_CREDENTIALS = 'Invalid email or password';

type UserWithRole = Prisma.UserGetPayload<{ include: { role: true } }>;

interface AccessTokenPayload {
  sub: string;
  sid: string;
}

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface LoginResult extends IssuedTokens {
  user: Omit<AuthUser, 'sessionId'>;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const matchesHash = (token: string, hash: string) => timingSafeEqual(Buffer.from(sha256(token)), Buffer.from(hash));

@Injectable()
export class AuthService {
  // Verified against unknown emails so response time does not reveal which accounts exist.
  private readonly dummyHash = hashPassword(randomBytes(16).toString('hex'));

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly systemLog: SystemLogService,
  ) {}

  async login(dto: LoginDto, meta: RequestMeta): Promise<LoginResult> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email }, include: { role: true } });

    if (!user || !user.isActive) {
      await verifyPassword(await this.dummyHash, dto.password);
      void this.systemLog.warn('SECURITY', 'auth.login_failed', 'Login failed: unknown or inactive account', {
        ipAddress: meta.ipAddress,
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account temporarily locked after repeated failed logins. Try again later.');
    }
    if (!(await verifyPassword(user.passwordHash, dto.password))) {
      await this.recordFailedLogin(user, meta);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const tokens = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
      });
      const issued = await this.createSession(user.id, meta, tx);
      await this.audit.record(
        { actorId: user.id, action: 'auth.login', entityType: 'User', entityId: user.id, meta },
        tx,
      );
      return issued;
    });
    return { ...tokens, user: this.toAuthUser(user) };
  }

  /** Rotates the refresh token. Presenting an already-rotated token revokes the whole session. */
  async refresh(refreshToken: string | undefined): Promise<IssuedTokens> {
    const session = await this.findSessionForRefreshToken(refreshToken);
    const presentedHash = sha256(refreshToken!);

    if (!matchesHash(refreshToken!, session.refreshTokenHash)) {
      await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      void this.systemLog.warn('SECURITY', 'auth.refresh_reuse_detected', 'Rotated refresh token reused; session revoked', {
        userId: session.userId,
        sessionId: session.id,
      });
      throw new UnauthorizedException('Session revoked');
    }
    if (!session.user.isActive) throw new UnauthorizedException('Session expired');

    const nextToken = `${session.id}.${randomBytes(32).toString('base64url')}`;
    // Conditional update: of two concurrent refreshes with the same token, only one wins.
    const { count } = await this.prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: presentedHash, revokedAt: null },
      data: { refreshTokenHash: sha256(nextToken), lastUsedAt: new Date() },
    });
    if (count !== 1) throw new UnauthorizedException('Session expired');

    return { ...(await this.signAccessToken(session.userId, session.id)), refreshToken: nextToken, refreshExpiresAt: session.expiresAt };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    const session = await this.findSessionForRefreshToken(refreshToken).catch(() => null);
    if (session && matchesHash(refreshToken!, session.refreshTokenHash)) {
      await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    }
  }

  /** Used by the HTTP guard (and later the WebSocket gateway) on every request. */
  async authenticate(accessToken: string): Promise<AuthUser> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(accessToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      include: { user: { include: { role: true } } },
    });
    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.user.isActive
    ) {
      throw new UnauthorizedException('Session expired');
    }
    return { ...this.toAuthUser(session.user), sessionId: session.id };
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto, meta: RequestMeta): Promise<void> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(record.passwordHash, dto.currentPassword))) {
      throw new BadRequestException('Current password is incorrect');
    }
    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      // Sign out every other device.
      await tx.session.updateMany({
        where: { userId: user.id, id: { not: user.sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        { actorId: user.id, action: 'auth.password_change', entityType: 'User', entityId: user.id, meta },
        tx,
      );
    });
  }

  listSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async revokeSession(user: AuthUser, sessionId: string, meta: RequestMeta): Promise<void> {
    const { count } = await this.prisma.session.updateMany({
      where: { id: sessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count > 0) {
      await this.audit.record({ actorId: user.id, action: 'auth.session_revoke', entityType: 'Session', entityId: sessionId, meta });
    }
  }

  private async createSession(userId: string, meta: RequestMeta, tx: Prisma.TransactionClient): Promise<IssuedTokens> {
    const { refreshTokenTtlDays } = await this.settings.get('security');
    const expiresAt = new Date(Date.now() + refreshTokenTtlDays * 86_400_000);
    // Token format "<sessionId>.<secret>" lets refresh find the session and detect reuse.
    const sessionId = randomUUID();
    const refreshToken = `${sessionId}.${randomBytes(32).toString('base64url')}`;
    await tx.session.create({
      data: { id: sessionId, userId, refreshTokenHash: sha256(refreshToken), expiresAt, ...meta },
    });
    return { ...(await this.signAccessToken(userId, sessionId)), refreshToken, refreshExpiresAt: expiresAt };
  }

  private async signAccessToken(userId: string, sessionId: string) {
    const { accessTokenTtlMinutes } = await this.settings.get('security');
    const expiresIn = accessTokenTtlMinutes * 60;
    const payload: AccessTokenPayload = { sub: userId, sid: sessionId };
    return { accessToken: await this.jwt.signAsync(payload, { expiresIn }), expiresIn };
  }

  private async findSessionForRefreshToken(token: string | undefined) {
    const sessionId = token?.split('.')[0];
    if (!sessionId || !isUUID(sessionId)) throw new UnauthorizedException('Missing or invalid refresh token');
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: { include: { role: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Session expired');
    }
    return session;
  }

  private async recordFailedLogin(user: UserWithRole, meta: RequestMeta): Promise<void> {
    const { maxFailedLogins } = await this.settings.get('security');
    const failures = user.failedLoginCount + 1;
    const lock = failures >= maxFailedLogins;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : failures,
        lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : undefined,
      },
    });
    void this.systemLog.warn(
      'SECURITY',
      lock ? 'auth.account_locked' : 'auth.login_failed',
      lock ? `Account locked for ${LOCK_MINUTES} minutes after ${failures} failed logins` : 'Login failed: wrong password',
      { userId: user.id, ipAddress: meta.ipAddress },
    );
  }

  private toAuthUser(user: UserWithRole): Omit<AuthUser, 'sessionId'> {
    return { id: user.id, email: user.email, name: user.name, role: user.role.name, permissions: user.role.permissions };
  }
}
