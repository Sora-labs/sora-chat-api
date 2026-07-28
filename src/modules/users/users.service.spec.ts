import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;
  let supabase: any;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    username: null,
    usernameSet: false,
    name: null,
    avatarUrl: null,
    bio: null,
    isBot: false,
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };
    supabase = { uploadAvatar: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: SupabaseService, useValue: supabase },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('getMe', () => {
    it('returns the user profile', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      const result = await service.getMe('user-1');
      expect(result.id).toBe('user-1');
    });

    it('throws NotFoundException if user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getMe('ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('sets username on first attempt and flips usernameSet', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(mockUser) // fetch current user
        .mockResolvedValueOnce(null); // username availability check
      prisma.user.update.mockResolvedValue({ ...mockUser, username: 'johndoe', usernameSet: true });

      await service.updateProfile('user-1', { username: 'johndoe' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { username: 'johndoe', usernameSet: true },
      });
    });

    it('throws BadRequestException if username already set once', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, usernameSet: true });

      await expect(
        service.updateProfile('user-1', { username: 'newname' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException if username is taken', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce({ id: 'other-user', username: 'johndoe' });

      await expect(
        service.updateProfile('user-1', { username: 'johndoe' }),
      ).rejects.toThrow(ConflictException);
    });

    it('updates name and bio without touching username', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue({ ...mockUser, name: 'John', bio: 'Hi' });

      await service.updateProfile('user-1', { name: 'John', bio: 'Hi' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { name: 'John', bio: 'Hi' },
      });
    });
  });

  describe('uploadAvatar', () => {
    it('throws BadRequestException if no file provided', async () => {
      await expect(service.uploadAvatar('user-1', undefined!)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects non-image files', async () => {
      const file = { mimetype: 'application/pdf', size: 100 } as Express.Multer.File;
      await expect(service.uploadAvatar('user-1', file)).rejects.toThrow(
        'File must be an image',
      );
    });

    it('rejects files over 5MB', async () => {
      const file = {
        mimetype: 'image/png',
        size: 6 * 1024 * 1024,
      } as Express.Multer.File;
      await expect(service.uploadAvatar('user-1', file)).rejects.toThrow(
        'Image must be under 5MB',
      );
    });

    it('uploads and persists the avatar URL', async () => {
      const file = {
        mimetype: 'image/png',
        size: 1000,
        buffer: Buffer.from('fake'),
      } as Express.Multer.File;
      supabase.uploadAvatar.mockResolvedValue('https://cdn.test/avatar.png');
      prisma.user.update.mockResolvedValue({ ...mockUser, avatarUrl: 'https://cdn.test/avatar.png' });

      const result = await service.uploadAvatar('user-1', file);

      expect(supabase.uploadAvatar).toHaveBeenCalledWith('user-1', file.buffer, 'image/png');
      expect(result.avatarUrl).toBe('https://cdn.test/avatar.png');
    });
  });

  describe('search', () => {
    it('excludes the current user and bots, matches email exactly and username fuzzily', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.search('user-1', 'john');

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { id: { not: 'user-1' } },
              { isBot: false },
              {
                OR: [
                  { email: { equals: 'john', mode: 'insensitive' } },
                  { username: { contains: 'john', mode: 'insensitive' } },
                ],
              },
            ],
          },
        }),
      );
    });
  });

  describe('findPublicProfile', () => {
    it('throws NotFoundException for a missing user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findPublicProfile('ghost')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('requestAccountDeletion', () => {
    it('throws NotFoundException if user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.requestAccountDeletion('ghost')).rejects.toThrow(NotFoundException);
    });

    it('sets deletionScheduledAt roughly 7 days out', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.user.update.mockResolvedValue({});

      const result = await service.requestAccountDeletion('u1');

      const diffDays = (result.deletionScheduledAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(6.9);
      expect(diffDays).toBeLessThan(7.1);
    });
  });

  describe('cancelAccountDeletion', () => {
    it('throws BadRequestException if no deletion is scheduled', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', deletionScheduledAt: null });
      await expect(service.cancelAccountDeletion('u1')).rejects.toThrow(BadRequestException);
    });

    it('clears deletionScheduledAt when one exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', deletionScheduledAt: new Date() });
      prisma.user.update.mockResolvedValue({});

      await service.cancelAccountDeletion('u1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { deletionScheduledAt: null },
      });
    });
  });
});