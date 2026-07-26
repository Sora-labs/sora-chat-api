import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FriendsService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: { userId },
      include: {
        friend: {
          select: { id: true, username: true, name: true, avatarUrl: true, bio: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return friendships.map((f) => f.friend);
  }

  async add(userId: string, friendId: string) {
    if (userId === friendId) {
      throw new BadRequestException('You cannot add yourself as a friend');
    }

    const friend = await this.prisma.user.findUnique({ where: { id: friendId } });
    if (!friend) throw new NotFoundException('User not found');

    const existing = await this.prisma.friendship.findUnique({
      where: { userId_friendId: { userId, friendId } },
    });
    if (existing) throw new BadRequestException('Already in friend list');

    await this.prisma.friendship.create({ data: { userId, friendId } });
    return { message: 'Friend added' };
  }

  async remove(userId: string, friendId: string) {
    const existing = await this.prisma.friendship.findUnique({
      where: { userId_friendId: { userId, friendId } },
    });
    if (!existing) throw new NotFoundException('Friendship not found');

    await this.prisma.friendship.delete({
      where: { userId_friendId: { userId, friendId } },
    });
    return { message: 'Friend removed' };
  }

  async getOne(userId: string, friendId: string) {
    const friendship = await this.prisma.friendship.findUnique({
      where: { userId_friendId: { userId, friendId } },
      include: {
        friend: {
          select: { id: true, username: true, name: true, avatarUrl: true, bio: true },
        },
      },
    });
    if (!friendship) throw new NotFoundException('Friendship not found');
    return friendship.friend;
  }
}