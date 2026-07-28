import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SoraService } from '../src/modules/sora/sora.service';
import { initTestApp } from '../src/utils/test';

describe('Sora (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let baseUrl: string;
  let userToken: string;
  let userId: string;
  let botConversationId: string;

  const soraId = process.env.SORA_USER_ID;
  const email = `sora-e2e-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SoraService)
      .useValue({
        generateReply: jest.fn().mockResolvedValue('This is a mocked Sora reply.'),
      })
      .compile();

    app = await initTestApp(moduleFixture);
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://localhost:${address.port}`;

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const user = await prisma.user.create({ data: { email } });
    userId = user.id;
    userToken = jwt.sign(
      { sub: user.id, email: user.email },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
    );

    const convo = await prisma.conversation.create({
      data: {
        isBotChat: true,
        participants: { create: [{ userId: user.id }, { userId: soraId as string }] },
      },
    });
    botConversationId = convo.id;
  });

  afterAll(async () => {
    await prisma.message.deleteMany({ where: { conversationId: botConversationId } });
    await prisma.conversationParticipant.deleteMany({ where: { conversationId: botConversationId } });
    await prisma.conversation.deleteMany({ where: { id: botConversationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
  });

  it('replies with a message from Sora after the user sends one', (done) => {
    const socket: Socket = io(baseUrl, {
      transports: ['websocket'],
      auth: { token: userToken },
    });

    let sawUserMessageEcho = false;

    socket.on('connect', () => {
      socket.emit('join_conversation', { conversationId: botConversationId });
    });

    socket.on('joined_conversation', () => {
      socket.emit('send_message', { conversationId: botConversationId, content: 'Hi Sora!' });
    });

    socket.on('new_message', (msg) => {
      if (msg.senderId === userId) {
        sawUserMessageEcho = true;
        expect(msg.content).toBe('Hi Sora!');
        return;
      }
      if (msg.senderId === soraId) {
        expect(sawUserMessageEcho).toBe(true); // user's message must broadcast first
        expect(msg.content).toBe('This is a mocked Sora reply.');
        socket.close();
        done();
      }
    });
  }, 10000);

  it('persists both the user message and Sora reply to the database', async () => {
    const messages = await prisma.message.findMany({
      where: { conversationId: botConversationId },
      orderBy: { createdAt: 'asc' },
    });

    expect(messages.length).toBe(2);
    expect(messages[0].senderId).toBe(userId);
    expect(messages[1].senderId).toBe(soraId);
    expect(messages[1].content).toBe('This is a mocked Sora reply.');
  });

  it('does NOT trigger a Sora reply in a normal (non-bot) conversation', async () => {
    const otherEmail = `sora-e2e-other-${Date.now()}@example.com`;
    const other = await prisma.user.create({ data: { email: otherEmail } });

    const normalConvo = await prisma.conversation.create({
      data: {
        isBotChat: false,
        participants: { create: [{ userId }, { userId: other.id }] },
      },
    });

    const socket: Socket = io(baseUrl, {
      transports: ['websocket'],
      auth: { token: userToken },
    });

    await new Promise<void>((resolve) => {
      socket.on('connect', () => {
        socket.emit('join_conversation', { conversationId: normalConvo.id });
      });
      socket.on('joined_conversation', () => {
        socket.emit('send_message', { conversationId: normalConvo.id, content: 'Hello!' });
        setTimeout(resolve, 1500); // give it time to (not) trigger a bot reply
      });
    });

    const messages = await prisma.message.findMany({ where: { conversationId: normalConvo.id } });
    expect(messages.length).toBe(1); // only the human message, no bot reply
    expect(messages[0].senderId).toBe(userId);

    socket.close();
    await prisma.message.deleteMany({ where: { conversationId: normalConvo.id } });
    await prisma.conversationParticipant.deleteMany({ where: { conversationId: normalConvo.id } });
    await prisma.conversation.deleteMany({ where: { id: normalConvo.id } });
    await prisma.user.deleteMany({ where: { id: other.id } });
  }, 5000);
});