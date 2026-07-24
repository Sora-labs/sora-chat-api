import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { ENV_KEYS } from '@/src/constants/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get(ENV_KEYS.JWT_ACCESS_SECRET) as string,
    });
  }

  async validate(payload: { sub: string; email: string }) {
    // attached to req.user
    return { userId: payload.sub, email: payload.email };
  }
}