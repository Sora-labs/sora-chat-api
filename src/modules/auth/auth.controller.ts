import { Body, Controller, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ENV_KEYS } from '../../constants/config';

const REFRESH_COOKIE_NAME = 'refreshToken';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService, private config: ConfigService) {}

  private setRefreshCookie(res: Response, refreshToken: string) {
    const maxAgeMs = this.parseDurationToMs(
      this.config.get(ENV_KEYS.JWT_REFRESH_EXPIRES_IN) ?? '30d',
    );
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: maxAgeMs,
      path: '/api/auth',
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
  }

  private parseDurationToMs(duration: string): number {
    const match = duration.match(/^(\d+)([dhm])$/);
    if (!match) throw new Error('Invalid duration format');
    const [, amount, unit] = match;
    const multipliers = {
      d: 86400000,
      h: 3600000,
      m: 60000,
    } as const;
    const ms = multipliers[unit as keyof typeof multipliers] * Number(amount);
    return ms;
  }

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('request-otp')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto.email);
  }

  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.verifyOtp(dto.email, dto.code);
    this.setRefreshCookie(res, result.refreshToken);
    return {
      accessToken: result.accessToken,
    };
  }

  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!refreshToken) throw new UnauthorizedException('No refresh token provided');

    const result = await this.authService.refresh(refreshToken);
    this.setRefreshCookie(res, result.refreshToken); // rotation: new cookie value
    return { accessToken: result.accessToken };
  }

  @Post('logout')
  async logout(@Req() req: Request,
    @Res({ passthrough: true }) res: Response,) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    this.clearRefreshCookie(res);
    return { message: 'Logged out' };
  }
}