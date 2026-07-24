import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SupabaseService } from '../src/modules/supabase/supabase.service';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let supabaseMock: any;

  beforeAll(async () => {
    supabaseMock = {
      authClient: {
        auth: {
          signInWithOtp: jest.fn().mockResolvedValue({ error: null }),
          verifyOtp: jest.fn(),
          refreshSession: jest.fn(),
        },
      },
      adminClient: {
        auth: { admin: { signOut: jest.fn().mockResolvedValue({ error: null }) } },
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SupabaseService)
      .useValue(supabaseMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => app.close());

  it('POST /auth/request-otp returns success on valid email', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/request-otp')
      .send({ email: 'test@example.com' })
      .expect(201);

    expect(res.body.message).toBe('OTP sent');
    expect(supabaseMock.authClient.auth.signInWithOtp).toHaveBeenCalled();
  });

  it('POST /auth/request-otp rejects invalid email format', async () => {
    await request(app.getHttpServer())
      .post('/auth/request-otp')
      .send({ email: 'not-an-email' })
      .expect(400);
  });

  it('POST /auth/verify-otp returns tokens on valid code', async () => {
    supabaseMock.authClient.auth.verifyOtp.mockResolvedValue({
      data: {
        session: { access_token: 'a.b.c', refresh_token: 'r.t.k', expires_in: 3600 },
        user: { id: '00000000-0000-0000-0000-000000000001' },
      },
      error: null,
    });

    const res = await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email: 'test@example.com', code: '123456' })
      .expect(201);

    expect(res.body.accessToken).toBe('a.b.c');
    expect(res.body).toHaveProperty('hasUsername');
  });

  it('POST /auth/verify-otp returns 400 on invalid code', async () => {
    supabaseMock.authClient.auth.verifyOtp.mockResolvedValue({
      data: { session: null },
      error: { message: 'Token has expired or is invalid' },
    });

    await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email: 'test@example.com', code: '000000' })
      .expect(400);
  });

  it('POST /auth/refresh returns a new token pair', async () => {
    supabaseMock.authClient.auth.refreshSession.mockResolvedValue({
      data: {
        session: { access_token: 'new.a', refresh_token: 'new.r', expires_in: 3600 },
      },
      error: null,
    });

    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'old.refresh' })
      .expect(201);

    expect(res.body.accessToken).toBe('new.a');
  });

  it('POST /auth/refresh returns 401 on invalid refresh token', async () => {
    supabaseMock.authClient.auth.refreshSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid Refresh Token' },
    });

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'garbage' })
      .expect(401);
  });

  it('POST /auth/logout succeeds', async () => {
    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ accessToken: 'a.b.c' })
      .expect(201);

    expect(supabaseMock.adminClient.auth.admin.signOut).toHaveBeenCalledWith(
      'a.b.c',
      'local',
    );
  });
});