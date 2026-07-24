import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let supabase: any;

  beforeEach(async () => {
    prisma = {
      profile: { findUnique: jest.fn() },
    };

    supabase = {
      authClient: {
        auth: {
          signInWithOtp: jest.fn(),
          verifyOtp: jest.fn(),
          refreshSession: jest.fn(),
        },
      },
      adminClient: {
        auth: { admin: { signOut: jest.fn() } },
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: SupabaseService, useValue: supabase },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('requestOtp', () => {
    it('calls Supabase signInWithOtp with shouldCreateUser: true', async () => {
      supabase.authClient.auth.signInWithOtp.mockResolvedValue({ error: null });

      const result = await service.requestOtp('test@example.com');

      expect(supabase.authClient.auth.signInWithOtp).toHaveBeenCalledWith({
        email: 'test@example.com',
        options: { shouldCreateUser: true },
      });
      expect(result.message).toBe('OTP sent');
    });

    it('throws BadRequestException if Supabase returns an error', async () => {
      supabase.authClient.auth.signInWithOtp.mockResolvedValue({
        error: { message: 'Rate limit exceeded' },
      });

      await expect(service.requestOtp('test@example.com')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('verifyOtp', () => {
    it('throws BadRequestException for an invalid/expired code', async () => {
      supabase.authClient.auth.verifyOtp.mockResolvedValue({
        data: { session: null },
        error: { message: 'Token has expired' },
      });

      await expect(
        service.verifyOtp('test@example.com', '000000'),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns tokens and hasUsername: false for a brand new profile', async () => {
      supabase.authClient.auth.verifyOtp.mockResolvedValue({
        data: {
          session: {
            access_token: 'access.token',
            refresh_token: 'refresh.token',
            expires_in: 3600,
          },
          user: { id: 'uuid-1' },
        },
        error: null,
      });
      prisma.profile.findUnique.mockResolvedValue({ id: 'uuid-1', username: null });

      const result = await service.verifyOtp('test@example.com', '123456');

      expect(result.accessToken).toBe('access.token');
      expect(result.hasUsername).toBe(false);
    });

    it('returns hasUsername: true for an existing profile with a username set', async () => {
      supabase.authClient.auth.verifyOtp.mockResolvedValue({
        data: {
          session: { access_token: 'a', refresh_token: 'r', expires_in: 3600 },
          user: { id: 'uuid-2' },
        },
        error: null,
      });
      prisma.profile.findUnique.mockResolvedValue({ id: 'uuid-2', username: 'johndoe' });

      const result = await service.verifyOtp('existing@example.com', '123456');

      expect(result.hasUsername).toBe(true);
    });
  });

  describe('refresh', () => {
    it('throws UnauthorizedException when Supabase rejects the refresh token', async () => {
      supabase.authClient.auth.refreshSession.mockResolvedValue({
        data: { session: null },
        error: { message: 'Invalid refresh token' },
      });

      await expect(service.refresh('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns a new token pair on success', async () => {
      supabase.authClient.auth.refreshSession.mockResolvedValue({
        data: {
          session: {
            access_token: 'new.access',
            refresh_token: 'new.refresh',
            expires_in: 3600,
          },
        },
        error: null,
      });

      const result = await service.refresh('valid-token');

      expect(result.accessToken).toBe('new.access');
      expect(result.refreshToken).toBe('new.refresh');
    });
  });

  describe('logout', () => {
    it('calls admin.signOut with the access token', async () => {
      await service.logout('some-access-token');

      expect(supabase.adminClient.auth.admin.signOut).toHaveBeenCalledWith(
        'some-access-token',
        'local',
      );
    });
  });
});