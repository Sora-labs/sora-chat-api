import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SupabaseService } from '../src/modules/supabase/supabase.service';
import { initTestApp } from '../src/utils/test';

describe('Chat (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let baseUrl: string;

  let userA: { id: string; token: string };
  let userB: { id: string; token: string };
  let conversationId: string;

  const emailA = `chat-e2e-a-${Date.now()}@example.com`;
  const emailB = `chat-e2e-b-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
    .overrideProvider(SupabaseService)
    .useValue({
      uploadChatMedia: jest.fn().mockResolvedValue('https://cdn.test/chat-media/fake.png'),
    }).compile();

    app = await initTestApp(moduleFixture);
    await app.listen(0); // random free port, needed for real socket connections

    const address = app.getHttpServer().address();
    baseUrl = `http://localhost:${address.port}`;

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const a = await prisma.user.create({ data: { email: emailA, username: 'chatuserA' } });
    const b = await prisma.user.create({ data: { email: emailB, username: 'chatuserB' } });

    userA = {
      id: a.id,
      token: jwt.sign({ sub: a.id, email: a.email }, {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: '15m',
      }),
    };
    userB = {
      id: b.id,
      token: jwt.sign({ sub: b.id, email: b.email }, {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: '15m',
      }),
    };
  });

  afterAll(async () => {
    await prisma.message.deleteMany({ where: { conversationId } });
    await prisma.conversationParticipant.deleteMany({ where: { conversationId } });
    await prisma.conversation.deleteMany({ where: { id: conversationId } });
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await app.close();
  });

  it('POST /api/conversations creates a direct conversation between two users', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/conversations')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ participantId: userB.id })
      .expect(201);

    expect(res.body.id).toBeDefined();
    conversationId = res.body.id;
  });

  it('POST /conversations returns the same conversation on a repeat call', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/conversations')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ participantId: userB.id })
      .expect(201);

    expect(res.body.id).toBe(conversationId);
  });

  it('GET /api/conversations lists it for both participants', async () => {
    const resA = await request(app.getHttpServer())
      .get('/api/conversations')
      .set('Authorization', `Bearer ${userA.token}`)
      .expect(200);
    expect(resA.body.some((c: any) => c.id === conversationId)).toBe(true);

    const resB = await request(app.getHttpServer())
      .get('/api/conversations')
      .set('Authorization', `Bearer ${userB.token}`)
      .expect(200);
    expect(resB.body.some((c: any) => c.id === conversationId)).toBe(true);
  });

  it('rejects socket connection with no token', (done) => {
    const badSocket = io(baseUrl, { transports: ['websocket'], auth: {} });
    badSocket.on('disconnect', () => {
      badSocket.close();
      done();
    });
  });

  it('delivers a real-time message from A to B over WebSocket', (done) => {
    const socketA: Socket = io(baseUrl, {
      transports: ['websocket'],
      auth: { token: userA.token },
    });
    const socketB: Socket = io(baseUrl, {
      transports: ['websocket'],
      auth: { token: userB.token },
    });

    let joinedCount = 0;
    const tryJoinBoth = () => {
      joinedCount++;
      if (joinedCount === 2) {
        socketA.emit('send_message', { conversationId, content: 'Hello B!' });
      }
    };

    socketB.on('connect', () => {
      socketB.emit('join_conversation', { conversationId });
    });
    socketB.on('joined_conversation', tryJoinBoth);

    socketA.on('connect', () => {
      socketA.emit('join_conversation', { conversationId });
    });
    socketA.on('joined_conversation', tryJoinBoth);

    socketB.on('new_message', (msg) => {
      expect(msg.content).toBe('Hello B!');
      expect(msg.sender.id).toBe(userA.id);
      socketA.close();
      socketB.close();
      done();
    });
  }, 10000);

  it('persists the message to the database', async () => {
    const messages = await prisma.message.findMany({ where: { conversationId } });
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('Hello B!');
  });

  it('GET /api/conversations/:id/messages returns persisted history', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${userA.token}`)
      .expect(200);

    expect(res.body.length).toBe(1);
    expect(res.body[0].content).toBe('Hello B!');
  });

  it('GET /api/conversations/:id/messages is forbidden for a non-participant', async () => {
    const strangerEmail = `chat-e2e-stranger-${Date.now()}@example.com`;
    const stranger = await prisma.user.create({ data: { email: strangerEmail } });
    const strangerToken = jwt.sign(
      { sub: stranger.id, email: stranger.email },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
    );

    await request(app.getHttpServer())
      .get(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(403);

    await prisma.user.delete({ where: { id: stranger.id } });
  });

  it('rejects join_conversation for a non-participant over the socket', (done) => {
    (async () => {
      const strangerEmail = `chat-e2e-stranger2-${Date.now()}@example.com`;
      const stranger = await prisma.user.create({ data: { email: strangerEmail } });
      const strangerToken = jwt.sign(
        { sub: stranger.id, email: stranger.email },
        { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
      );

      const socket = io(baseUrl, {
        transports: ['websocket'],
        auth: { token: strangerToken },
      });

      socket.on('connect', () => {
        socket.emit('join_conversation', { conversationId });
      });

      socket.on('error', async (err) => {
        expect(err.message).toMatch(/Not a participant/);
        socket.close();
        await prisma.user.delete({ where: { id: stranger.id } });
        done();
      });
    })();
  }, 10000);

  it('rejects a media upload from a non-participant', async () => {
    const strangerEmail = `chat-e2e-media-stranger-${Date.now()}@example.com`;
    const stranger = await prisma.user.create({ data: { email: strangerEmail } });
    const strangerToken = jwt.sign(
      { sub: stranger.id, email: stranger.email },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
    );

    await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/media`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .attach('file', Buffer.from('fake-image'), { filename: 'x.png', contentType: 'image/png' })
      .expect(403);

    await prisma.user.delete({ where: { id: stranger.id } });
  });

  it('rejects a non-image file type', async () => {
    await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/media`)
      .set('Authorization', `Bearer ${userA.token}`)
      .attach('file', Buffer.from('fake-pdf-content'), {
        filename: 'doc.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
  });

  it('rejects a file exceeding MEDIA_CAPACITY_PER_UPLOAD', async () => {
    const oversized = Buffer.alloc(
      Number(process.env.MEDIA_CAPACITY_PER_UPLOAD) + 1,
    );

    await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/media`)
      .set('Authorization', `Bearer ${userA.token}`)
      .attach('file', oversized, { filename: 'big.png', contentType: 'image/png' })
      .expect(400);
  });

  it('uploads a valid image and broadcasts it live to the other participant', (done) => {
    const socketB: Socket = io(baseUrl, {
      transports: ['websocket'],
      auth: { token: userB.token },
    });

    socketB.on('connect', () => {
      socketB.emit('join_conversation', { conversationId });
    });

    socketB.on('joined_conversation', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/conversations/${conversationId}/media`)
        .set('Authorization', `Bearer ${userA.token}`)
        .field('caption', 'Look at this')
        .attach('file', Buffer.from('small-fake-image'), {
          filename: 'photo.png',
          contentType: 'image/png',
        })
        .expect(201);

      expect(res.body.mediaUrl).toBe('https://cdn.test/chat-media/fake.png');
      expect(res.body.mediaType).toBe('image');
      expect(res.body.content).toBe('Look at this');
    });

    socketB.on('new_message', (msg) => {
      if (msg.mediaType === 'image') {
        expect(msg.content).toBe('Look at this');
        socketB.close();
        done();
      }
    });
  }, 10000);

  it('persists mediaUrl, mediaType, and mediaSize to the database', async () => {
    const mediaMessages = await prisma.message.findMany({
      where: { conversationId, mediaType: 'image' },
    });
    Logger.log(`media message ${mediaMessages}`)
    expect(mediaMessages.length).toBe(1);
    expect(mediaMessages[0].mediaUrl).toBe('https://cdn.test/chat-media/fake.png');
  });
});