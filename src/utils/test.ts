import { TestingModule } from "@nestjs/testing";
import { ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";

export async function initTestApp(moduleFixture: TestingModule) {
  const app = moduleFixture.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  return app
}