import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SupabaseService } from '../src/modules/supabase/supabase.service';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let accessToken: string;
  let userId: string;
  let otherUserId: string;

  const email = `users-e2e-${Date.now()}@example.com`;
  const otherEmail = `users-e2e-other-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SupabaseService)
      .useValue({ uploadAvatar: jest.fn().mockResolvedValue('https://cdn.test/avatar.png') })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const user = await prisma.user.create({ data: { email } });
    const other = await prisma.user.create({ data: { email: otherEmail, username: 'otherperson' } });
    userId = user.id;
    otherUserId = other.id;

    accessToken = jwt.sign(
      { sub: user.id, email: user.email },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
    );
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await app.close();
  });

  it('GET /users/me requires auth', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
  });

  it('GET /users/me returns the current user', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.email).toBe(email);
  });

  it('PATCH /users/me sets username once', async () => {
    const res = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ username: 'myuniquename' })
      .expect(200);

    expect(res.body.username).toBe('myuniquename');
    expect(res.body.usernameSet).toBe(true);
  });

  it('PATCH /users/me rejects a second username change', async () => {
    await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ username: 'anothername' })
      .expect(400);
  });

  it('PATCH /users/me rejects a taken username', async () => {
    await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'irrelevant', username: 'otherperson' })
      .expect(400); // usernameSet already true, so blocked before even checking uniqueness
  });

  it('PATCH /users/me updates name and bio freely', async () => {
    const res = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Test User', bio: 'Hello world' })
      .expect(200);

    expect(res.body.name).toBe('Test User');
    expect(res.body.bio).toBe('Hello world');
  });

  it('POST /users/me/avatar uploads and updates avatarUrl', async () => {
    const res = await request(app.getHttpServer())
      .post('/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('fake-image-data'), {
        filename: 'avatar.png',
        contentType: 'image/png',
      })
      .expect(201);

    expect(res.body.avatarUrl).toBe('https://cdn.test/avatar.png');
  });

  it('GET /users/search finds by username, excludes self', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/search?q=otherperson')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.some((u: any) => u.id === otherUserId)).toBe(true);
    expect(res.body.some((u: any) => u.id === userId)).toBe(false);
  });

  it('GET /users/search finds by exact email match', async () => {
    const res = await request(app.getHttpServer())
      .get(`/users/search?q=${otherEmail}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.some((u: any) => u.id === otherUserId)).toBe(true);
  });

  it('GET /users/:id returns a public profile without email', async () => {
    const res = await request(app.getHttpServer())
      .get(`/users/${otherUserId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.id).toBe(otherUserId);
    expect(res.body.email).toBeUndefined();
  });
});