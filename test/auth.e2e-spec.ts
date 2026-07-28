import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailerService } from '../src/modules/mailer/mailer.service';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const testEmail = `e2e-test-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailerService)
      .useValue({ sendOtp: jest.fn() }) // don't send real emails in tests
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    if (user) {
      // Clean up Sora conversation + participants created during verifyOtp
      const conversations = await prisma.conversationParticipant.findMany({
        where: { userId: user.id },
        select: { conversationId: true },
      });
      const conversationIds = conversations.map((c) => c.conversationId);

      await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
      await prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: conversationIds } } });
      await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
    }

    await prisma.refreshToken.deleteMany({ where: { user: { email: testEmail } } });
    await prisma.otpCode.deleteMany({ where: { userEmail: testEmail } });
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await app.close();
  });

  let refreshToken: string;
  let accessToken: string;

  it('POST /api/auth/request-otp sends a code and persists it', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/request-otp')
      .send({ email: testEmail })
      .expect(201);

    expect(res.body.message).toBe('OTP sent');

    const otp = await prisma.otpCode.findFirst({
      where: { userEmail: testEmail, consumed: false },
    });
    expect(otp).toBeDefined();
  });

  it('POST /api/auth/request-otp rejects an invalid email', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/request-otp')
      .send({ email: 'not-an-email' })
      .expect(400);
  });

  it('POST /api/auth/verify-otp rejects a wrong code', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/verify-otp')
      .send({ email: testEmail, code: '000000' })
      .expect(400);
  });

  it('POST /api/auth/verify-otp logs in with the correct code, creates a new user', async () => {
    const otp = await prisma.otpCode.findFirst({
      where: { userEmail: testEmail, consumed: false },
      orderBy: { createdAt: 'desc' },
    });

    const res = await request(app.getHttpServer())
      .post('/api/auth/verify-otp')
      .send({ email: testEmail, code: otp?.code })
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();

    refreshToken = res.body.refreshToken;
    accessToken = res.body.accessToken;

    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    expect(user).toBeDefined();
  });

  it('POST /api/auth/verify-otp rejects reuse of an already-consumed code', async () => {
    const consumedOtp = await prisma.otpCode.findFirst({
      where: { userEmail: testEmail },
      orderBy: { createdAt: 'desc' },
    });

    await request(app.getHttpServer())
      .post('/api/auth/verify-otp')
      .send({ email: testEmail, code: consumedOtp?.code })
      .expect(400);
  });

  it('protected route rejects requests with no token', async () => {
    await request(app.getHttpServer()).get('/api/users/me').expect(401);
  });

  it('protected route accepts a valid access token', async () => {
    // Assumes a GET /users/me route exists once Users module is built (Step 4)
    await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect((res) => {
        expect([200]).toContain(res.status);
      });
  });

  it('POST /api/auth/refresh issues a new token pair and rotates the old one', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.refreshToken).not.toBe(refreshToken); // rotated

    // old refresh token should now be rejected (replay protection)
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    refreshToken = res.body.refreshToken; // update for logout test
  });

  it('POST /api/auth/logout revokes the refresh token', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .send({ refreshToken })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });
});