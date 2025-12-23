import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function parseOrigins(value?: string) {
  if (!value) return true; // allow all if not set (ok for early dev)
  const origins = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return origins.length ? origins : true;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  app.enableCors({
    origin: parseOrigins(process.env.CORS_ORIGIN),
    credentials: true,
  });

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

bootstrap();
