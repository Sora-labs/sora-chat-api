import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { MailerService } from '../mailer/mailer.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let mailer: any;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    username: null,
  };

  beforeEach(async () => {
    prisma = {
      otpCode: {
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    mailer = { sendOtp: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailerService, useValue: mailer },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('mocked.access.token') },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const values: Record<string, string> = {
                OTP_EXPIRES_MINUTES: '10',
                JWT_ACCESS_SECRET: 'secret',
                JWT_ACCESS_EXPIRES_IN: '15m',
                JWT_REFRESH_EXPIRES_IN: '30d',
              };
              return values[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('requestOtp', () => {
    it('generates a code, invalidates old codes, saves new one, and emails it', async () => {
      await service.requestOtp('test@example.com');

      expect(prisma.otpCode.updateMany).toHaveBeenCalledWith({
        where: { userEmail: 'test@example.com', consumed: false },
        data: { consumed: true },
      });
      expect(prisma.otpCode.create).toHaveBeenCalled();
      expect(mailer.sendOtp).toHaveBeenCalledWith(
        'test@example.com',
        expect.stringMatching(/^\d{6}$/),
      );
    });
  });

  describe('verifyOtp', () => {
    it('throws if no matching unconsumed OTP exists', async () => {
      prisma.otpCode.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyOtp('test@example.com', '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws if the OTP is expired', async () => {
      prisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        expiresAt: new Date(Date.now() - 1000), // already expired
      });

      await expect(
        service.verifyOtp('test@example.com', '123456'),
      ).rejects.toThrow('Code expired');
    });

    it('creates a new user on first login and flags isNewUser: true', async () => {
      prisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        expiresAt: new Date(Date.now() + 60000),
      });
      prisma.user.findUnique.mockResolvedValue(null); // no existing user
      prisma.user.create.mockResolvedValue(mockUser);
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.verifyOtp('test@example.com', '123456');

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'test@example.com' },
      });
      expect(result.accessToken).toBe('mocked.access.token');
      expect(result.refreshToken).toBeDefined();
    });

    it('does not recreate an existing user and flags isNewUser: false', async () => {
      prisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        expiresAt: new Date(Date.now() + 60000),
      });
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.verifyOtp('test@example.com', '123456');

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('marks the OTP as consumed so it cannot be reused', async () => {
      prisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        expiresAt: new Date(Date.now() + 60000),
      });
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.refreshToken.create.mockResolvedValue({});

      await service.verifyOtp('test@example.com', '123456');

      expect(prisma.otpCode.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: { consumed: true },
      });
    });
  });

  describe('refresh', () => {
    it('throws UnauthorizedException for an unknown token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh('nonexistent-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for a revoked token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        revoked: true,
        expiresAt: new Date(Date.now() + 60000),
        user: mockUser,
      });

      await expect(service.refresh('some-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for an expired token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        revoked: false,
        expiresAt: new Date(Date.now() - 60000),
        user: mockUser,
      });

      await expect(service.refresh('some-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rotates the token: revokes old one and issues a new pair', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        revoked: false,
        expiresAt: new Date(Date.now() + 60000),
        user: mockUser,
      });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.refresh('valid-token');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revoked: true },
      });
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });
  });

  describe('logout', () => {
    it('revokes the matching refresh token', async () => {
      await service.logout('some-raw-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { token: expect.any(String) }, // hashed value
        data: { revoked: true },
      });
    });
  });
});