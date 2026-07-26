import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Friends (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let accessToken: string;
  let userId: string;
  let friendId: string;

  const email = `friends-e2e-${Date.now()}@example.com`;
  const friendEmail = `friends-e2e-target-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const user = await prisma.user.create({ data: { email } });
    const friend = await prisma.user.create({ data: { email: friendEmail, username: 'futurefriend' } });
    userId = user.id;
    friendId = friend.id;

    accessToken = jwt.sign(
      { sub: user.id, email: user.email },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
    );
  });

  afterAll(async () => {
    await prisma.friendship.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, friendId] } } });
    await app.close();
  });

  it('GET /friends returns an empty list initially', async () => {
    const res = await request(app.getHttpServer())
      .get('/friends')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toEqual([]);
  });

  it('POST /friends/:friendId rejects adding yourself', async () => {
    await request(app.getHttpServer())
      .post(`/friends/${userId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('POST /friends/:friendId rejects a nonexistent user', async () => {
    await request(app.getHttpServer())
      .post('/friends/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });

  it('POST /friends/:friendId adds a friend', async () => {
    await request(app.getHttpServer())
      .post(`/friends/${friendId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/friends')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(friendId);
  });

  it('POST /friends/:friendId rejects duplicate add', async () => {
    await request(app.getHttpServer())
      .post(`/friends/${friendId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('GET /friends/:friendId returns the specific friend', async () => {
    const res = await request(app.getHttpServer())
      .get(`/friends/${friendId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.id).toBe(friendId);
  });

  it('DELETE /friends/:friendId removes the friend', async () => {
    await request(app.getHttpServer())
      .delete(`/friends/${friendId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/friends')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toEqual([]);
  });

  it('DELETE /friends/:friendId on a nonexistent friendship returns 404', async () => {
    await request(app.getHttpServer())
      .delete(`/friends/${friendId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });
});