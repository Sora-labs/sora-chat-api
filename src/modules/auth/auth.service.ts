import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { MailerService } from '../mailer/mailer.service';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ENV_KEYS } from '../../constants/config';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  private generateCode(): string {
    return crypto.randomInt(100000, 999999).toString();
  }

  async requestOtp(email: string) {
    const code = this.generateCode();
    const expiresAt = new Date(
      Date.now() + Number(this.config.get(ENV_KEYS.OTP_EXPIRES_MINUTES)) * 60 * 1000,
    );

    // Invalidate previous unused codes for this email
    await this.prisma.otpCode.updateMany({
      where: { userEmail: email, consumed: false },
      data: { consumed: true },
    });

    await this.prisma.otpCode.create({
      data: { userEmail: email, code, expiresAt },
    });

    await this.mailer.sendOtp(email, code);
    return { message: 'OTP sent' };
  }

  async verifyOtp(email: string, code: string) {
    const otp = await this.prisma.otpCode.findFirst({
      where: { userEmail: email, code, consumed: false },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) throw new BadRequestException('Invalid code');
    if (otp.expiresAt < new Date()) throw new BadRequestException('Code expired');

    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumed: true },
    });

    // Find or create user
    let user = await this.prisma.user.findUnique({ where: { email } });

    if (user?.deletionScheduledAt) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { deletionScheduledAt: null },
      });
    }

    if (!user) {
      user = await this.prisma.user.create({ data: { email } });

      const soraId = this.config.get(ENV_KEYS.SORA_USER_ID);
      await this.prisma.conversation.create({
        data: {
          isBotChat: true,
          participants: { create: [{ userId: user.id }, { userId: soraId }] },
        },
      });
    }

    return this.issueTokens(user.id, user.email);
  }

  async issueTokens(userId: string, email: string) {
    const accessToken = this.jwt.sign(
      { sub: userId, email },
      {
        secret: this.config.get(ENV_KEYS.JWT_ACCESS_SECRET),
        expiresIn: this.config.get(ENV_KEYS.JWT_ACCESS_EXPIRES_IN),
      },
    );

    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const hashedRefreshToken = this.hashToken(rawRefreshToken);
    const refreshExpiresAt = this.addDuration(
      this.config.get(ENV_KEYS.JWT_REFRESH_EXPIRES_IN) as string,
    );

    await this.prisma.refreshToken.create({
      data: {
        token: hashedRefreshToken,
        userId,
        expiresAt: refreshExpiresAt,
      },
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  async refresh(rawRefreshToken: string) {
    const hashed = this.hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: hashed },
      include: { user: true },
    });

    if (!stored || stored.revoked || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotate: revoke old, issue new pair
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revoked: true },
    });

    return this.issueTokens(stored.user.id, stored.user.email);
  }

  async logout(rawRefreshToken: string) {
    const hashed = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { token: hashed },
      data: { revoked: true },
    });
    return { message: 'Logged out' };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private addDuration (duration: string): Date {
    const match = duration.match(/^(\d+)([dhm])$/);
    if (!match) throw new Error('Invalid duration format');
    const [, amount, unit] = match;
    const multipliers = {
      d: 86400000,
      h: 3600000,
      m: 60000,
    } as const;
    const ms = multipliers[unit as keyof typeof multipliers] * Number(amount);
    return new Date(Date.now() + ms);
  }
}