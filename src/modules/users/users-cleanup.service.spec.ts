import { Test, TestingModule } from '@nestjs/testing';
import { UsersCleanupService } from './users-cleanup.service';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('UsersCleanupService', () => {
  let service: UsersCleanupService;
  let prisma: any;
  let usersService: any;

  beforeEach(async () => {
    prisma = { user: { findMany: jest.fn() } };
    usersService = { permanentlyDeleteAccount: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersCleanupService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get(UsersCleanupService);
  });

  it('permanently deletes every user whose deletionScheduledAt has passed', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);

    await service.handleScheduledDeletions();

    expect(usersService.permanentlyDeleteAccount).toHaveBeenCalledWith('u1');
    expect(usersService.permanentlyDeleteAccount).toHaveBeenCalledWith('u2');
    expect(usersService.permanentlyDeleteAccount).toHaveBeenCalledTimes(2);
  });

  it('does nothing when no accounts are due', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await service.handleScheduledDeletions();
    expect(usersService.permanentlyDeleteAccount).not.toHaveBeenCalled();
  });
});