import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { ENV_KEYS } from '../../constants/config';

@Injectable()
export class MailerService {
  private resend: Resend;

  constructor(private config: ConfigService) {
    this.resend = new Resend(this.config.get(ENV_KEYS.RESEND_API_KEY));
  }

  async sendOtp(email: string, code: string) {
    await this.resend.emails.send({
      from: this.config.get(ENV_KEYS.RESEND_FROM_EMAIL) as string,
      to: email,
      subject: 'Your login code',
      html: `<p>Your verification code is <strong>${code}</strong>. It expires in ${this.config.get('OTP_EXPIRES_MINUTES')} minutes.</p>`,
    });
  }
}