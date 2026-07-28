import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PrismaService } from '../../prisma/prisma.service';

const PUBLIC_SELECT = {
  id: true,
  username: true,
  name: true,
  avatarUrl: true,
  bio: true,
  isBot: true,
};

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
  ) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const { ...rest } = user;
    return rest;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (dto.username !== undefined) {
      if (user.usernameSet) {
        throw new BadRequestException('Username can only be set once');
      }
      const taken = await this.prisma.user.findUnique({
        where: { username: dto.username },
      });
      if (taken) throw new ConflictException('Username already taken');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.username !== undefined && {
          username: dto.username,
          usernameSet: true,
        }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
      },
    });
  }

  async uploadAvatar(userId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('File must be an image');
    }
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_SIZE) {
      throw new BadRequestException('Image must be under 5MB');
    }

    const avatarUrl = await this.supabase.uploadAvatar(
      userId,
      file.buffer,
      file.mimetype,
    );

    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });
  }

  async search(currentUserId: string, query: string) {
    return this.prisma.user.findMany({
      where: {
        AND: [
          { id: { not: currentUserId } },
          { isBot: false },
          {
            OR: [
              { email: { equals: query, mode: 'insensitive' } },
              { username: { contains: query, mode: 'insensitive' } },
            ],
          },
        ],
      },
      select: PUBLIC_SELECT,
      take: 20,
    });
  }

  async findPublicProfile(targetId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: PUBLIC_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async requestAccountDeletion(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const deletionScheduledAt = new Date();
    deletionScheduledAt.setDate(deletionScheduledAt.getDate() + 7);

    await this.prisma.user.update({
      where: { id: userId },
      data: { deletionScheduledAt },
    });

    return {
      message: 'Account scheduled for deletion',
      deletionScheduledAt,
    };
  }

  async cancelAccountDeletion(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.deletionScheduledAt) {
      throw new BadRequestException('Account is not scheduled for deletion');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { deletionScheduledAt: null },
    });

    return { message: 'Account deletion cancelled' };
  }

  async permanentlyDeleteAccount(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const conversations = await this.prisma.conversationParticipant.findMany({
      where: { userId },
      select: { conversationId: true },
    });
    const conversationIds = conversations.map((c) => c.conversationId);

    await this.prisma.$transaction([
      this.prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } }),
      this.prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: conversationIds } } }),
      this.prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } }),
      this.prisma.friendship.deleteMany({ where: { OR: [{ userId }, { friendId: userId }] } }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      this.prisma.otpCode.deleteMany({ where: { userEmail: user.email } }),
      this.prisma.user.delete({ where: { id: userId } }),
    ]);

    return { message: 'Account and all associated data deleted' };
  }
}