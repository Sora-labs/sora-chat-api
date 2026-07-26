import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ChatService', () => {
  let service: ChatService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      conversation: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() },
      conversationParticipant: { findUnique: jest.fn() },
      message: { findMany: jest.fn(), create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ChatService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ChatService);
  });

  describe('findOrCreateDirectConversation', () => {
    it('throws BadRequestException if userId equals otherUserId', async () => {
      await expect(
        service.findOrCreateDirectConversation('u1', 'u1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if other user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.findOrCreateDirectConversation('u1', 'ghost'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the existing conversation if one already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u2' });
      prisma.conversation.findFirst.mockResolvedValue({ id: 'convo-1' });

      const result = await service.findOrCreateDirectConversation('u1', 'u2');

      expect(result.id).toBe('convo-1');
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });

    it('creates a new conversation with both participants if none exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u2' });
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue({ id: 'convo-new' });

      const result = await service.findOrCreateDirectConversation('u1', 'u2');

      expect(prisma.conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            isBotChat: false,
            participants: { create: [{ userId: 'u1' }, { userId: 'u2' }] },
          },
        }),
      );
      expect(result.id).toBe('convo-new');
    });
  });

  describe('isParticipant', () => {
    it('returns true when a participant row exists', async () => {
      prisma.conversationParticipant.findUnique.mockResolvedValue({ id: 'p1' });
      expect(await service.isParticipant('c1', 'u1')).toBe(true);
    });

    it('returns false when no participant row exists', async () => {
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);
      expect(await service.isParticipant('c1', 'u1')).toBe(false);
    });
  });

  describe('getMessages', () => {
    it('throws ForbiddenException if user is not a participant', async () => {
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);
      await expect(service.getMessages('c1', 'u1')).rejects.toThrow(ForbiddenException);
    });

    it('returns messages in oldest-first order', async () => {
      prisma.conversationParticipant.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.message.findMany.mockResolvedValue([
        { id: 'm2', content: 'second', createdAt: new Date('2026-01-02') },
        { id: 'm1', content: 'first', createdAt: new Date('2026-01-01') },
      ]);

      const result = await service.getMessages('c1', 'u1');

      expect(result[0].id).toBe('m1');
      expect(result[1].id).toBe('m2');
    });
  });

  describe('createMessage', () => {
    it('throws ForbiddenException if sender is not a participant', async () => {
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);
      await expect(
        service.createMessage('c1', 'u1', 'hello'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates and returns the message with sender info', async () => {
      prisma.conversationParticipant.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.message.create.mockResolvedValue({
        id: 'm1',
        content: 'hello',
        sender: { id: 'u1', username: 'alice' },
      });

      const result = await service.createMessage('c1', 'u1', 'hello');

      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { conversationId: 'c1', senderId: 'u1', content: 'hello' },
        }),
      );
      expect(result.content).toBe('hello');
    });
  });

  describe('createMediaMessage', () => {
  it('throws ForbiddenException if sender is not a participant', async () => {
    prisma.conversationParticipant.findUnique.mockResolvedValue(null);
    await expect(
      service.createMediaMessage('c1', 'u1', 'https://cdn.test/img.png', 'image', 1000),
    ).rejects.toThrow(ForbiddenException);
  });

  it('creates a media message with null content when no caption given', async () => {
    prisma.conversationParticipant.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.message.create.mockResolvedValue({
      id: 'm1',
      mediaUrl: 'https://cdn.test/img.png',
      mediaType: 'image',
      content: null,
    });

    await service.createMediaMessage('c1', 'u1', 'https://cdn.test/img.png', 'image', 1000);

    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: null, mediaType: 'image' }),
      }),
    );
  });

  it('stores the caption as content when provided', async () => {
    prisma.conversationParticipant.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.message.create.mockResolvedValue({ id: 'm1', content: 'Check this out' });

    await service.createMediaMessage(
      'c1', 'u1', 'https://cdn.test/img.png', 'image', 1000, 'Check this out',
    );

    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: 'Check this out' }),
      }),
    );
  });
});
});