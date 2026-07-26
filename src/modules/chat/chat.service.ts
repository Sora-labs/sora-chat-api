import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const PARTICIPANT_SELECT = {
  user: {
    select: { id: true, username: true, name: true, avatarUrl: true, isBot: true },
  },
};

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService) {}

  async findOrCreateDirectConversation(userId: string, otherUserId: string) {
    if (userId === otherUserId) {
      throw new BadRequestException('Cannot start a conversation with yourself');
    }

    const otherUser = await this.prisma.user.findUnique({ where: { id: otherUserId } });
    if (!otherUser) throw new NotFoundException('User not found');

    const existing = await this.prisma.conversation.findFirst({
      where: {
        isBotChat: false,
        participants: { every: { userId: { in: [userId, otherUserId] } } },
        AND: [
          { participants: { some: { userId } } },
          { participants: { some: { userId: otherUserId } } },
        ],
      },
      include: { participants: { select: PARTICIPANT_SELECT } },
    });
    if (existing) return existing;

    return this.prisma.conversation.create({
      data: {
        isBotChat: false,
        participants: { create: [{ userId }, { userId: otherUserId }] },
      },
      include: { participants: { select: PARTICIPANT_SELECT } },
    });
  }

  async isParticipant(conversationId: string, userId: string): Promise<boolean> {
    const p = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    return !!p;
  }

  async listConversations(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { participants: { some: { userId } } },
      include: {
        participants: { select: PARTICIPANT_SELECT },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    return conversations
      .map((c) => ({
        id: c.id,
        isBotChat: c.isBotChat,
        otherParticipants: c.participants
          .map((p) => p.user)
          .filter((u) => u.id !== userId),
        lastMessage: c.messages[0] ?? null,
      }))
      .sort((a, b) => {
        const aTime = a.lastMessage?.createdAt ?? new Date(0);
        const bTime = b.lastMessage?.createdAt ?? new Date(0);
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });
  }

  async getMessages(conversationId: string, userId: string, before?: string, limit = 30) {
    const allowed = await this.isParticipant(conversationId, userId);
    if (!allowed) throw new ForbiddenException('Not a participant in this conversation');

    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(before && { cursor: { id: before }, skip: 1 }),
      include: {
        sender: { select: { id: true, username: true, name: true, avatarUrl: true } },
      },
    });

    return messages.reverse(); // oldest-first for rendering
  }

  async createMessage(conversationId: string, senderId: string, content: string) {
    const allowed = await this.isParticipant(conversationId, senderId);
    if (!allowed) throw new ForbiddenException('Not a participant in this conversation');

    return this.prisma.message.create({
      data: { conversationId, senderId, content },
      include: {
        sender: { select: { id: true, username: true, name: true, avatarUrl: true } },
      },
    });
  }

  async createMediaMessage(
    conversationId: string,
    senderId: string,
    mediaUrl: string,
    mediaType: string,
    mediaSize: number,
    caption?: string,
  ) {
    const allowed = await this.isParticipant(conversationId, senderId);
    if (!allowed) throw new ForbiddenException('Not a participant in this conversation');

    return this.prisma.message.create({
      data: {
        conversationId,
        senderId,
        content: caption || "",
        mediaUrl,
        mediaType,
        mediaSize,
      },
      include: {
        sender: { select: { id: true, username: true, name: true, avatarUrl: true } },
      },
    });
  }
}