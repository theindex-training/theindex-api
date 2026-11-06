import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, DeepPartial } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { AttendanceEntity } from '../../src/attendance/attendance.entity';
import { BootstrapService } from '../../src/bootstrap/bootstrap.service';
import { JSON_BODY_LIMIT } from '../../src/common/http/body-limit';
import { CashRegisterKvEntity } from '../../src/cash-register/cash-register-kv.entity';
import { CashRegisterTransactionEntity } from '../../src/cash-register/cash-register-transaction.entity';
import { AccountRole } from '../../src/common/enums/account-role.enum';
import { AccountStatus } from '../../src/common/enums/account-status.enum';
import { PlanType } from '../../src/common/enums/plan-type.enum';
import { GymLocationEntity } from '../../src/gym-locations/gym-location.entity';
import { PlanEntity } from '../../src/plans/plan.entity';
import { SettlementAllocationEntity } from '../../src/settlements/settlement-allocation.entity';
import { SettlementLineEntity } from '../../src/settlements/settlement-line.entity';
import { SettlementEntity } from '../../src/settlements/settlement.entity';
import { SubscriptionEntity } from '../../src/subscriptions/subscription.entity';
import { TraineeProfileEntity } from '../../src/trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../../src/trainer-profiles/trainer-profile.entity';

/** Admin seeded by the real BootstrapService (INF-07). */
export const E2E_ADMIN = { email: 'e2e-admin', password: 'e2e-admin-pass' };
export const E2E_JWT_SECRET = 'e2e-test-only-secret';

/**
 * INF-06: boots the full AppModule with the same setup as `main.ts`
 * (`setGlobalPrefix('api')`, the global ValidationPipe options and the JSON body limit). `main.ts`
 * is not exported, so the setup is duplicated here (TEST_PLAN Q4).
 *
 * DB settings come from DB_* (CI sets them to the test database). Env vars
 * already in `process.env` win over `.env`, and the suite refuses to run
 * against a database whose name doesn't end in `_test`, because every test
 * truncates all tables. JWT_SECRET and the seed admin are set here, before
 * compiling, because `JwtStrategy` reads the secret in its constructor.
 */
export async function createE2eApp(): Promise<INestApplication<App>> {
  process.env.JWT_SECRET = E2E_JWT_SECRET;
  delete process.env.JWT_EXPIRES_IN;
  process.env.SEED_ADMIN_EMAIL = E2E_ADMIN.email;
  process.env.SEED_ADMIN_PASSWORD = E2E_ADMIN.password;

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  // Errors/warnings only: the per-request route and seed logs drown the output.
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    logger: ['error', 'warn'],
  });
  (app as unknown as NestExpressApplication).useBodyParser('json', {
    limit: JSON_BODY_LIMIT,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  const database = String(app.get(DataSource).options.database);
  if (!database.endsWith('_test')) {
    await app.close();
    throw new Error(
      `Refusing to run e2e tests against "${database}": DB_NAME must end with "_test" (tables are truncated).`,
    );
  }

  return app;
}

/**
 * Truncates every table, then re-runs the real admin seed so `loginAsAdmin`
 * keeps working after the truncate.
 */
export async function resetDatabase(app: INestApplication): Promise<void> {
  const ds = app.get(DataSource);
  const tables = ds.entityMetadatas.map((m) => `"${m.tableName}"`).join(', ');
  await ds.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  await app.get(BootstrapService).onModuleInit();
}

/**
 * Registers the per-file lifecycle: one app per file, a clean DB before each
 * test, and `app.close()` at the end (clears the subscriptions cron timer).
 */
export function setupE2eSuite(): () => E2eContext {
  let ctx: E2eContext | undefined;

  beforeAll(async () => {
    ctx = new E2eContext(await createE2eApp());
  }, 30_000);

  beforeEach(async () => {
    await resetDatabase(ctx!.app);
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  return () => ctx!;
}

export type Role = 'ADMIN' | 'TRAINER' | 'TRAINEE';

/** HTTP + data helpers shared by the e2e specs. */
export class E2eContext {
  readonly ds: DataSource;

  constructor(readonly app: INestApplication<App>) {
    this.ds = app.get(DataSource);
  }

  http() {
    return request(this.app.getHttpServer());
  }

  // ---- auth (INF-07) ----

  /** Real login through `POST /api/auth/login`; returns the access token. */
  async loginAs(email: string, password: string): Promise<string> {
    const res = await this.http()
      .post('/api/auth/login')
      .send({ email, password })
      .expect(201);
    return (res.body as { accessToken: string }).accessToken;
  }

  loginAsAdmin(): Promise<string> {
    return this.loginAs(E2E_ADMIN.email, E2E_ADMIN.password);
  }

  /**
   * Provisions an account for a profile through the real admin route
   * (`POST /api/accounts/:profileType/:profileId`) and logs it in, so the
   * token carries the real JWT claims.
   */
  async provisionAndLogin(
    profileType: 'trainer' | 'trainee',
    profileId: string,
    email = `${profileType}-${profileId}@e2e.test`,
  ): Promise<string> {
    const adminToken = await this.loginAsAdmin();
    const password = 'password-123';
    await this.http()
      .post(`/api/accounts/${profileType}/${profileId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email,
        role:
          profileType === 'trainer' ? AccountRole.TRAINER : AccountRole.TRAINEE,
        status: AccountStatus.ACTIVE,
        password,
        confirmPassword: password,
      })
      .expect(201);
    return this.loginAs(email, password);
  }

  /**
   * Signs a token with the app's own JwtService for payload edge cases the
   * real login can't produce (e.g. TRAINEE with `traineeProfileId: null`).
   */
  signToken(payload: {
    sub?: string;
    email?: string;
    role: Role;
    trainerProfileId?: string | null;
    traineeProfileId?: string | null;
  }): string {
    return this.app.get(JwtService).sign({
      sub: '00000000-0000-4000-8000-000000000000',
      email: 'signed@e2e.test',
      trainerProfileId: null,
      traineeProfileId: null,
      ...payload,
    });
  }

  /**
   * Every route registered on the Express app, as `METHOD /path` (e.g.
   * `GET /api/plans/:id`). Used by the role matrix (AUTH-11) to fail when a
   * route is added without a row.
   */
  registeredRoutes(): string[] {
    type Layer = {
      route?: { path: string; methods: Record<string, boolean> };
    };
    const express = this.app.getHttpAdapter().getInstance() as {
      router: { stack: Layer[] };
    };
    return express.router.stack.flatMap((layer) =>
      layer.route
        ? Object.keys(layer.route.methods).map(
            (m) => `${m.toUpperCase()} ${layer.route!.path}`,
          )
        : [],
    );
  }

  // ---- reference data (plain CRUD, inserted directly) ----

  trainer(name = 'Trainer', extra: DeepPartial<TrainerProfileEntity> = {}) {
    return this.ds
      .getRepository(TrainerProfileEntity)
      .save({ name, nickname: null, isActive: true, ...extra });
  }

  trainee(name = 'Trainee', extra: DeepPartial<TraineeProfileEntity> = {}) {
    return this.ds
      .getRepository(TraineeProfileEntity)
      .save({ name, nickname: null, phone: null, isActive: true, ...extra });
  }

  location(name = 'Main') {
    return this.ds
      .getRepository(GymLocationEntity)
      .save({ name, isActive: true });
  }

  punchPlan(credits: number, priceCents: number) {
    return this.ds.getRepository(PlanEntity).save({
      type: PlanType.PUNCH,
      title: `Punch ${credits}`,
      priceCents,
      credits,
      durationDays: null,
      isActive: true,
    });
  }

  // ---- reads ----

  subscriptionRows() {
    return this.ds.getRepository(SubscriptionEntity).find();
  }

  attendanceRows() {
    return this.ds.getRepository(AttendanceEntity).find();
  }

  settlementRows() {
    return this.ds.getRepository(SettlementEntity).find();
  }

  linesOf(settlementId: string) {
    return this.ds
      .getRepository(SettlementLineEntity)
      .find({ where: { settlementId } });
  }

  allocationsOf(settlementId: string) {
    return this.ds
      .getRepository(SettlementAllocationEntity)
      .find({ where: { settlementId } });
  }

  cashTxs() {
    return this.ds
      .getRepository(CashRegisterTransactionEntity)
      .find({ order: { createdAt: 'ASC' } });
  }

  async balance(): Promise<number> {
    const row = await this.ds
      .getRepository(CashRegisterKvEntity)
      .findOneBy({ key: 'cash_register_balance_cents' });
    return row ? Number(row.value) : 0;
  }
}

/** Decodes a JWT payload without verifying it (the app already did). */
export function jwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}

/** Reads `message` from a Nest error body (string or validation array). */
export function messageOf(body: unknown): string | string[] {
  return (body as { message: string | string[] }).message;
}
