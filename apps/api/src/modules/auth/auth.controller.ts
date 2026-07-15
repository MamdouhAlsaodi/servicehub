import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RequestResetDto } from './dto/request-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { DemoGoogleLoginDto } from './dto/demo-google-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Tiny pure parser scoped to this controller: only the refresh endpoint
// reads cookies; the JwtStrategy has its own scoped extractor.
function parseCookieHeader(
  cookieHeader: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (name) out[name] = decodeURIComponent(trimmed.slice(eq + 1).trim());
  }
  return out;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto);
    this.setAuthCookies(res, result.accessToken, result.refreshToken);
    // JWTs live only in HttpOnly cookies set above — never in JSON.
    return { user: result.user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = parseCookieHeader(req.headers.cookie)['refresh_token'];
    if (!refreshToken) {
      throw new BadRequestException('Refresh token cookie is missing');
    }
    const tokens = await this.authService.refresh(refreshToken);
    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return { ok: true };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.logout(userId);
    this.clearAuthCookies(res);
    return result;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser('id') userId: string) {
    return this.authService.me(userId);
  }

  @Get('vendor-status')
  @UseGuards(JwtAuthGuard)
  async getVendorStatus(@CurrentUser('id') userId: string) {
    return this.authService.getVendorStatus(userId);
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async requestPasswordReset(@Body() dto: RequestResetDto) {
    return this.authService.requestPasswordReset(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  // DEMO ONLY: Google OAuth is simulated for this portfolio project.
  // No Google credentials, external authorization, or real user identity is used.
  @Post('demo-google-login')
  @HttpCode(HttpStatus.OK)
  async demoGoogleLogin(
    @Body() dto: DemoGoogleLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.demoGoogleLogin(dto.email);
    this.setAuthCookies(res, result.accessToken, result.refreshToken);
    return { user: result.user, authProvider: 'demo-google' as const };
  }

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ): void {
    const baseOptions = {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    };
    res.cookie('access_token', accessToken, { ...baseOptions, maxAge: ACCESS_TOKEN_MAX_AGE_MS });
    res.cookie('refresh_token', refreshToken, { ...baseOptions, maxAge: REFRESH_TOKEN_MAX_AGE_MS });
    // Double-submit CSRF companion: a JS-readable token rotated on
    // every login / refresh. Must NOT be HttpOnly — the browser
    // reads it via `document.cookie` and echoes it back in the
    // `x-csrf-token` header on unsafe requests. Same lifetime as the
    // access_token so the two rotate together.
    res.cookie('csrf_token', randomBytes(32).toString('hex'), {
      httpOnly: false,
      sameSite: 'lax' as const,
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: ACCESS_TOKEN_MAX_AGE_MS,
    });
    // Non-sensitive session-presence hint for the web client. Pure
    // marker ("1") — no token, user id, email, or role. Lets
    // AuthProvider skip /api/v1/auth/me on anonymous visits (which
    // would otherwise 401 and pollute the browser console) without
    // making /me public. Lifetime mirrors access_token so it rotates
    // and expires together.
    res.cookie('sh_session', '1', {
      httpOnly: false,
      sameSite: 'lax' as const,
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: ACCESS_TOKEN_MAX_AGE_MS,
    });
  }

  private clearAuthCookies(res: Response): void {
    const baseOptions = {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    };
    // The csrf_token attributes mirror what setAuthCookies wrote:
    // same `path`, `sameSite`, and `secure` so the browser's cookie
    // jar actually deletes the entry instead of leaving a stranded
    // sibling cookie with mismatched metadata.
    const csrfOptions = {
      httpOnly: false,
      sameSite: 'lax' as const,
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    };
    res.cookie('access_token', '', { ...baseOptions, maxAge: 0 });
    res.cookie('refresh_token', '', { ...baseOptions, maxAge: 0 });
    res.cookie('csrf_token', '', { ...csrfOptions, maxAge: 0 });
    // Session-presence hint uses the same JS-readable attributes
    // (same path / sameSite / secure) so the browser's jar drops it.
    res.cookie('sh_session', '', { ...csrfOptions, maxAge: 0 });
  }
}
