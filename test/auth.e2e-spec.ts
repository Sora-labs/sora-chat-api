import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailerService } from '../src/modules/mailer/mailer.service';
import { initTestApp } from '../src/utils/test';
import { UsersService } from '../src/modules/users/users.service';
import { SupabaseService } from '../src/modules/supabase/supabase.service';

const REFRESH_COOKIE_NAME = 'refreshToken';

function getSetCookies(res: request.Response): string[] {
  const raw = res.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let usersService: UsersService;
  const testEmail = `e2e-test-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailerService)
      .useValue({ sendOtp: jest.fn() })
      .overrideProvider(SupabaseService)
      .useValue({
        uploadAvatar: jest.fn(),
        deleteAvatar: jest.fn(),
        uploadChatMedia: jest.fn(),
      })
      .compile();

    app = await initTestApp(moduleFixture);
    await app.init();

    prisma = app.get(PrismaService);
    usersService = app.get(UsersService);
  });

  afterAll(async () => {
    // Best-effort full cleanup, bypassing the 7-day grace period entirely —
    // this is test cleanup, not a real user-facing deletion flow.
    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    if (user) {
      await usersService.permanentlyDeleteAccount(user.id).catch(() => {});
    }
    await app.close();
  });

  // A single persistent agent across the whole suite — this is what makes
  // cookies set by one request (Set-Cookie on verify-otp) automatically
  // get sent on the next request (refresh, logout), just like a real browser.
  let session: ReturnType<typeof request.agent>;

  beforeAll(() => {
    session = request.agent(app.getHttpServer());
  });

  it('POST /api/auth/request-otp sends a code and persists it', async () => {
    const res = await session
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
    await session
      .post('/api/auth/request-otp')
      .send({ email: 'not-an-email' })
      .expect(400);
  });

  it('POST /api/auth/verify-otp rejects a wrong code', async () => {
    await session
      .post('/api/auth/verify-otp')
      .send({ email: testEmail, code: '000000' })
      .expect(400);
  });

  let accessToken: string;
  let firstRefreshCookie: string; // captured raw for manual replay testing later

  it('POST /api/auth/verify-otp logs in, returns accessToken in body, sets refreshToken as an httpOnly cookie', async () => {
    const otp = await prisma.otpCode.findFirst({
      where: { userEmail: testEmail, consumed: false },
      orderBy: { createdAt: 'desc' },
    });

    const res = await session
      .post('/api/auth/verify-otp')
      .send({ email: testEmail, code: otp?.code })
      .expect(201);

    // Access token comes back in the JSON body — this is what the frontend
    // keeps in memory and attaches as a Bearer token.
    expect(res.body.accessToken).toBeDefined();
    // Refresh token must NOT be present in the JSON body anymore.
    expect(res.body.refreshToken).toBeUndefined();

    accessToken = res.body.accessToken;

    // Assert the Set-Cookie header is present, correctly scoped, and httpOnly.
    const setCookieHeader = getSetCookies(res);
    expect(setCookieHeader.length).toBeGreaterThan(0);
    const refreshCookie = setCookieHeader.find((c) =>
      c.startsWith(`${REFRESH_COOKIE_NAME}=`),
    );
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toMatch(/HttpOnly/i);
    expect(refreshCookie).toMatch(/Path=\/api\/auth/i);

    // Strip cookie attributes (Path, HttpOnly, etc), keep just "name=value"
    // so it can be manually replayed on a one-off request later.
    firstRefreshCookie = refreshCookie?.split(';')[0] as string;

    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    expect(user).toBeDefined();

    // Confirm Sora's conversation was auto-created for this new user.
    const soraConvo = await prisma.conversation.findFirst({
      where: { isBotChat: true, participants: { some: { userId: user?.id } } },
    });
    expect(soraConvo).toBeDefined();
  });

  it('POST /api/auth/verify-otp rejects reuse of an already-consumed code', async () => {
    const consumedOtp = await prisma.otpCode.findFirst({
      where: { userEmail: testEmail },
      orderBy: { createdAt: 'desc' },
    });

    await session
      .post('/api/auth/verify-otp')
      .send({ email: testEmail, code: consumedOtp?.code })
      .expect(400);
  });

  it('protected route rejects requests with no access token', async () => {
    // Note: use a plain request here, not the cookie-bearing agent, to prove
    // that the refresh cookie ALONE is not sufficient to authenticate an
    // ordinary API call — only the Bearer access token is.
    await request(app.getHttpServer()).get('/api/users/me').expect(401);
  });

  it('protected route accepts a valid Bearer access token', async () => {
    const res = await session
      .get('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.email).toBe(testEmail);
  });

  it('POST /api/auth/refresh fails with no refresh cookie present', async () => {
    // A fresh, cookie-less client — simulates an incognito tab or cleared cookies.
    await request(app.getHttpServer()).post('/api/auth/refresh').expect(401);
  });

  it('POST /api/auth/refresh reads the cookie automatically, rotates it, returns a new accessToken', async () => {
    const res = await session.post('/api/auth/refresh').expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.accessToken).not.toBe(accessToken); // genuinely a new token
    expect(res.body.refreshToken).toBeUndefined(); // never exposed in the body

    const setCookieHeader = getSetCookies(res);
    expect(setCookieHeader.length).toBeGreaterThan(0);
    const refreshCookie = setCookieHeader.find((c) =>
      c.startsWith(`${REFRESH_COOKIE_NAME}=`),
    );
    expect(refreshCookie).toBeDefined();

    accessToken = res.body.accessToken; // update for subsequent tests
  });

  it('the old (pre-rotation) refresh cookie is rejected if replayed after rotation', async () => {
    // `session` has already moved forward to the rotated cookie by this point.
    // Here we manually replay the ORIGINAL cookie value (captured right after
    // verify-otp, before the /refresh call rotated it) on a fresh, independent
    // request — proving the old token is genuinely dead, not just superseded
    // in this particular client's cookie jar.
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', firstRefreshCookie)
      .expect(401);

    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    const revokedCount = await prisma.refreshToken.count({
      where: { userId: user?.id, revoked: true },
    });
    expect(revokedCount).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/auth/logout reads the cookie, revokes the token, and clears the cookie', async () => {
    const res = await session.post('/api/auth/logout').expect(201);

    expect(res.body.message).toMatch(/logged out/i);

    const setCookieHeader = getSetCookies(res);
    expect(setCookieHeader.length).toBeGreaterThan(0);
    const refreshCookie = setCookieHeader.find((c) =>
      c.startsWith(`${REFRESH_COOKIE_NAME}=`),
    );
    // Clearing a cookie sends it back with an empty value and past expiry.
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });

  it('POST /api/auth/refresh fails after logout since the cookie is cleared and token revoked', async () => {
    await session.post('/api/auth/refresh').expect(401);
  });

  it('POST /api/auth/logout is a no-op (still 200/201) when no cookie is present', async () => {
    // A logout call with nothing to log out of shouldn't error — it's idempotent.
    await request(app.getHttpServer()).post('/api/auth/logout').expect(201);
  });
});