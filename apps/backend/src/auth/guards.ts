import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../common/auth.types';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../common/decorators';
import { hasPermissions } from '../common/permissions';
import { AuthService } from './auth.service';

/** Global: every route requires a valid access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Missing bearer token');

    req.user = await this.auth.authenticate(token);
    return true;
  }
}

/** Global: enforces @RequirePermissions(...) against the authenticated user's role. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required?.length) return true;

    const { user } = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user || !hasPermissions(user.permissions, required)) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    return true;
  }
}
