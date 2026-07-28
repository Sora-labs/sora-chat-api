import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from './users.service';

@Injectable()
export class UsersCleanupService {
  private logger = new Logger('UsersCleanupService');

  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleScheduledDeletions() {
    const dueUsers = await this.prisma.user.findMany({
      where: { deletionScheduledAt: { lte: new Date() } },
      select: { id: true },
    });

    for (const user of dueUsers) {
      await this.usersService.permanentlyDeleteAccount(user.id);
      this.logger.log(`Permanently deleted account: ${user.id}`);
    }

    if (dueUsers.length) {
      this.logger.log(`Deletion sweep complete: ${dueUsers.length} account(s) removed`);
    }
  }
}