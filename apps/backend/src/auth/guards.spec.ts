import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../common/decorators';
import { AuthService } from './auth.service';
import { JwtAuthGuard, PermissionsGuard } from './guards';

function context(req: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function reflectorWith(metadata: Record<string, unknown>): Reflector {
  return { getAllAndOverride: (key: string) => metadata[key] } as unknown as Reflector;
}

describe('JwtAuthGuard', () => {
  const auth = { authenticate: jest.fn().mockResolvedValue({ id: 'u1' }) } as unknown as AuthService;

  it('lets @Public() routes through without a token', async () => {
    const guard = new JwtAuthGuard(reflectorWith({ [IS_PUBLIC_KEY]: true }), auth);
    await expect(guard.canActivate(context({ headers: {} }))).resolves.toBe(true);
  });

  it('rejects requests without a bearer token', async () => {
    const guard = new JwtAuthGuard(reflectorWith({}), auth);
    await expect(guard.canActivate(context({ headers: {} }))).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(context({ headers: { authorization: 'Basic abc' } }))).rejects.toThrow(UnauthorizedException);
  });

  it('attaches the authenticated user to the request', async () => {
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer token-1' } };
    await new JwtAuthGuard(reflectorWith({}), auth).canActivate(context(req));
    expect(auth.authenticate).toHaveBeenCalledWith('token-1');
    expect(req.user).toEqual({ id: 'u1' });
  });
});

describe('PermissionsGuard', () => {
  const guardFor = (required?: string[]) => new PermissionsGuard(reflectorWith({ [PERMISSIONS_KEY]: required }));

  it('allows routes without permission requirements', () => {
    expect(guardFor().canActivate(context({ user: { permissions: [] } }))).toBe(true);
  });

  it('grants everything to the "*" permission', () => {
    expect(guardFor(['users:manage']).canActivate(context({ user: { permissions: ['*'] } }))).toBe(true);
  });

  it('requires every listed permission', () => {
    const req = { user: { permissions: ['logs:read'] } };
    expect(guardFor(['logs:read']).canActivate(context(req))).toBe(true);
    expect(() => guardFor(['logs:read', 'audit:read']).canActivate(context(req))).toThrow(ForbiddenException);
  });
});
