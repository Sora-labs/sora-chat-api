import { TestingModule } from "@nestjs/testing";
import { ValidationPipe } from "@nestjs/common";

export async function initTestApp(moduleFixture: TestingModule) {
  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  return app
}