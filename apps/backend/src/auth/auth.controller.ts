import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { AuthUser, requestMeta } from '../common/auth.types';
import { CurrentUser, Public } from '../common/decorators';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto } from './dto/auth.dto';

const REFRESH_COOKIE = 'refresh_token';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly cookieOptions: CookieOptions;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService,
  ) {
    // httpOnly: unreadable by JS. SameSite=strict + narrow path: only sent to auth endpoints.
    this.cookieOptions = {
      httpOnly: true,
      secure: config.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { refreshToken, refreshExpiresAt, ...result } = await this.auth.login(dto, requestMeta(req));
    res.cookie(REFRESH_COOKIE, refreshToken, { ...this.cookieOptions, expires: refreshExpiresAt });
    return result;
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const { refreshToken, refreshExpiresAt, ...result } = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]);
      res.cookie(REFRESH_COOKIE, refreshToken, { ...this.cookieOptions, expires: refreshExpiresAt });
      return result;
    } catch (error) {
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<null> {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions);
    return null;
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('change-password')
  @HttpCode(200)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Req() req: Request): Promise<null> {
    await this.auth.changePassword(user, dto, requestMeta(req));
    return null;
  }

  @ApiBearerAuth()
  @Get('sessions')
  async sessions(@CurrentUser() user: AuthUser) {
    const sessions = await this.auth.listSessions(user.id);
    return sessions.map((s) => ({ ...s, current: s.id === user.sessionId }));
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  async revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<null> {
    await this.auth.revokeSession(user, id, requestMeta(req));
    return null;
  }
}
