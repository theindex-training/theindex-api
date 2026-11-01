import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Same setup as main.ts (INF-06); AppModule alone doesn't include it.
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  }, 30_000);

  afterAll(async () => {
    // Also clears the subscriptions cron timer, so no --forceExit is needed.
    await app?.close();
  });

  it('APP-01 GET /api returns the greeting without auth', () => {
    return request(app.getHttpServer())
      .get('/api')
      .expect(200)
      .expect('Hello TheIndex!');
  });

  it('APP-01 GET /api/health returns { ok: true } without auth', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ ok: true });
  });
});
