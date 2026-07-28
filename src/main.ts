import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from "cookie-parser"
import { ENV_KEYS } from './constants/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({
    origin: ENV_KEYS.FRONTEND_URL, // e.g. http://localhost:5173, NOT '*'
    credentials: true, // required for cookies to be sent cross-origin
  });
  await app.listen(ENV_KEYS.PORT ?? 3000);
}
bootstrap();
