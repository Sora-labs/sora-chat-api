import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FriendsService } from './friends.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('FriendsService', () => {
  let service: FriendsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      friendship: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      user: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [FriendsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(FriendsService);
  });

  describe('list', () => {
    it('returns the friend profiles, not the friendship rows', async () => {
      prisma.friendship.findMany.mockResolvedValue([
        { friend: { id: 'f1', username: 'alice' } },
        { friend: { id: 'f2', username: 'bob' } },
      ]);

      const result = await service.list('user-1');

      expect(result).toEqual([
        { id: 'f1', username: 'alice' },
        { id: 'f2', username: 'bob' },
      ]);
    });
  });

  describe('add', () => {
    it('throws BadRequestException when adding yourself', async () => {
      await expect(service.add('user-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException if target user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.add('user-1', 'ghost')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException if already friends', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      prisma.friendship.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.add('user-1', 'user-2')).rejects.toThrow(
        'Already in friend list',
      );
    });

    it('creates the friendship on success', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      prisma.friendship.findUnique.mockResolvedValue(null);
      prisma.friendship.create.mockResolvedValue({});

      await service.add('user-1', 'user-2');

      expect(prisma.friendship.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', friendId: 'user-2' },
      });
    });
  });

  describe('remove', () => {
    it('throws NotFoundException if friendship does not exist', async () => {
      prisma.friendship.findUnique.mockResolvedValue(null);
      await expect(service.remove('user-1', 'user-2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deletes the friendship on success', async () => {
      prisma.friendship.findUnique.mockResolvedValue({ id: 'fr-1' });
      prisma.friendship.delete.mockResolvedValue({});

      await service.remove('user-1', 'user-2');

      expect(prisma.friendship.delete).toHaveBeenCalledWith({
        where: { userId_friendId: { userId: 'user-1', friendId: 'user-2' } },
      });
    });
  });
});