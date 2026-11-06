import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { JSON_BODY_LIMIT } from './common/http/body-limit';
import {
  DEV_MEDIA_ROUTE,
  isProduction,
  loadMediaConfig,
} from './media/media.config';

function parseOrigins(value?: string) {
  if (!value) return true; // allow all if not set (ok for early dev)
  const origins = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return origins.length ? origins : true;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });

  // Development only: serve uploaded images from the local storage folder, as nginx at
  // media.theindex.training does in production (MEDIA_PUBLIC_URL points here by default).
  if (!isProduction(process.env)) {
    try {
      const { storageDir } = loadMediaConfig(process.env, {
        production: false,
      });
      app.useStaticAssets(storageDir, {
        prefix: DEV_MEDIA_ROUTE,
        index: false,
      });
    } catch {
      // Invalid media settings: media requests answer 503 and log the problem.
    }
  }

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: parseOrigins(process.env.CORS_ORIGIN),
    credentials: true,
  });

  const config = new DocumentBuilder()
    .setTitle('The Index API')
    .setDescription('CrossFit attendance, subscriptions, settlements')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'jwt', // name used by @ApiBearerAuth('jwt')
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();
