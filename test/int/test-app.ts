import { DynamicModule, Type } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AccountEntity } from '../../src/accounts/account.entity';
import { AttendanceModule } from '../../src/attendance/attendance.module';
import { CashRegisterModule } from '../../src/cash-register/cash-register.module';
import { GymLocationEntity } from '../../src/gym-locations/gym-location.entity';
import { GymSubscriptionEntity } from '../../src/gym-subscriptions/gym-subscription.entity';
import { PlanEntity } from '../../src/plans/plan.entity';
import { SettlementsModule } from '../../src/settlements/settlements.module';
import { SubscriptionsModule } from '../../src/subscriptions/subscriptions.module';
import { TraineeProfileEntity } from '../../src/trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../../src/trainer-profiles/trainer-profile.entity';
import { restoreTime } from './clock';
import { Fixtures } from './fixtures';

/**
 * INF-01: dedicated Postgres test database. Configure with TEST_DB_* env vars
 * (see .env.example). The schema is dropped and re-created per suite, so the
 * database name must end in `_test` to make pointing this at a real DB hard.
 */
export function testDbOptions() {
  const database = process.env.TEST_DB_NAME ?? 'theindex_test';
  if (!database.endsWith('_test')) {
    throw new Error(
      `Refusing to run integration tests against "${database}": TEST_DB_NAME must end with "_test".`,
    );
  }

  return {
    type: 'postgres' as const,
    host: process.env.TEST_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.TEST_DB_PORT ?? 5432),
    username: process.env.TEST_DB_USER ?? 'theindex',
    password: process.env.TEST_DB_PASS ?? 'theindex',
    database,
    autoLoadEntities: true,
    synchronize: true,
    dropSchema: true,
    retryAttempts: 0,
    logging: false,
  };
}

type ModuleImport = Type<unknown> | DynamicModule;

/**
 * Builds the real feature modules (no mocked collaborators) on top of the
 * test database. `compile()` does not run lifecycle hooks, so the
 * subscriptions cron timer is never scheduled. `extraImports` adds feature
 * modules a suite needs on top of the shared set (e.g. AccountsModule).
 */
export async function createIntegrationModule(
  extraImports: ModuleImport[] = [],
): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot(testDbOptions()),
      // Entities used only to build fixtures (not owned by the modules below).
      TypeOrmModule.forFeature([
        AccountEntity,
        PlanEntity,
        TraineeProfileEntity,
        TrainerProfileEntity,
        GymLocationEntity,
        GymSubscriptionEntity,
      ]),
      CashRegisterModule,
      SubscriptionsModule,
      AttendanceModule,
      SettlementsModule,
      ...extraImports,
    ],
  }).compile();
}

export async function truncateAll(dataSource: DataSource): Promise<void> {
  const tables = dataSource.entityMetadatas
    .map((m) => `"${m.tableName}"`)
    .join(', ');
  await dataSource.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

/**
 * Registers the per-suite lifecycle: one Nest module + schema per suite,
 * all tables truncated before each test, real timers restored after each.
 * Returns a getter for the fixtures (they exist only after beforeAll).
 */
export function setupIntegrationSuite(
  opts: { extraImports?: ModuleImport[] } = {},
): () => Fixtures {
  let moduleRef: TestingModule | undefined;
  let fixtures: Fixtures | undefined;

  beforeAll(async () => {
    moduleRef = await createIntegrationModule(opts.extraImports);
    fixtures = new Fixtures(moduleRef);
  });

  beforeEach(async () => {
    await truncateAll(fixtures!.ds);
  });

  afterEach(() => {
    restoreTime();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  return () => fixtures!;
}
