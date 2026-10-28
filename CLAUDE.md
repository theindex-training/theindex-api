# theindex-api

REST backend for The Index, a CrossFit gym app covering attendance, plans/subscriptions, settlements and the cash register. The frontend lives in the sibling repo `theindex-training/theindex-front`.

## Stack
- NestJS 11, TypeScript 5 (`module: nodenext`), Node 20 (`.nvmrc`, Docker image `node:20-alpine`)
- PostgreSQL through TypeORM 0.3 (`autoLoadEntities`; schema is managed by `synchronize` when `DB_SYNC=true`. There are **no migrations**)
- Auth: Passport local (login) + JWT bearer (`@nestjs/jwt`, `passport-jwt`), bcrypt password hashes
- Validation: `class-validator`/`class-transformer`; docs: `@nestjs/swagger`
- Tests: Jest 30 + ts-jest, supertest for e2e

## Commands
```bash
npm ci                      # install (lockfile is committed; CI/Docker use npm ci)
cp .env.example .env        # local config: needs a running Postgres
npm run start:dev           # watch mode on :3000
npm run build               # nest build -> dist/
npm run start:prod          # node dist/main
npm test                    # unit tests (src/**/*.spec.ts)
npm run test:e2e            # test/*.e2e-spec.ts: boots AppModule, needs Postgres; add --forceExit (cron timer keeps the process alive)
npx eslint "{src,apps,libs,test}/**/*.ts"   # lint without modifying files
npm run lint                # NOTE: runs eslint --fix and rewrites files
npm run format              # prettier --write
```
Local Postgres matching `.env.example`: user/pass/db `theindex`, port 5432. On boot, `BootstrapService` seeds an ADMIN account from `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` (`admin`/`admin` in the example). Swagger UI is at `http://localhost:3000/api/docs`. `tests.md` has a manual curl scenario for the whole domain.

Known baseline on `main` (as of Oct 2026): build passes; `eslint` reports ~36 errors / 17 warnings (prettier + unsafe-any); `app.controller.spec.ts` and `test/app.e2e-spec.ts` fail because they still expect `'Hello World!'` (the service returns `'Hello TheIndex!'`). The other unit tests pass. Don't treat these as regressions you caused, and don't hide them either.

## Folder structure
```
src/
  main.ts               # global prefix 'api', ValidationPipe, CORS, Swagger
  app.module.ts         # ConfigModule (global) + TypeORM + all feature modules
  <feature>/            # one Nest module per domain:
    <feature>.module.ts / .controller.ts / .service.ts
    <name>.entity.ts    # TypeORM entity (table name in @Entity('...'))
    dto/                # create-*/update-*/*.query.dto.ts
    enums/, *.util.ts   # feature-local enums and pure helpers (+ *.spec.ts)
  auth/                 # login, JWT strategy, JwtAuthGuard, RolesGuard, @Roles()
  common/enums/         # shared enums (AccountRole, PlanType, statuses…)
  bootstrap/            # seeds the admin account on startup
test/                   # e2e specs + jest-e2e.json
```
Features: accounts, attendance, cash-register, gym-locations, gym-subscriptions, plans, settlements, subscriptions (incl. a daily cron in `subscriptions-cron.service.ts`), trainee-profiles, trainer-profiles, training-times.

## API conventions
- Every route is under `/api` (`app.setGlobalPrefix('api')`). Resources are kebab-case plurals: `/api/plans`, `/api/gym-locations`, `/api/trainees/:traineeId/subscriptions`, `/api/trainees/me/training-insights`.
- CRUD shape: `GET /x`, `GET /x/:id`, `POST /x`, `PATCH /x/:id`, `DELETE /x/:id`. Ids are UUIDs (`@PrimaryGeneratedColumn('uuid')`). Some deletes are soft (e.g. plans `deactivate`).
- Auth: `POST /api/auth/login` `{email, password}` → `{accessToken, account}`; `GET /api/auth/me` returns the JWT payload (`sub`, `email`, `role`, `trainerProfileId`, `traineeProfileId`). The frontend decodes this payload, so changing JWT claims is a cross-repo change.
- Protect controllers with `@UseGuards(JwtAuthGuard, RolesGuard)` + `@ApiBearerAuth('jwt')` + `@Roles(AccountRole.…)` at class level, and override `@Roles` per handler. Roles: `ADMIN`, `TRAINER`, `TRAINEE`.
- Request bodies and queries are DTO classes with class-validator decorators and `@ApiProperty`/`@ApiPropertyOptional`. The global `ValidationPipe` uses `whitelist` + `forbidNonWhitelisted` + `transform`, so unknown fields return 400. Every accepted field must be declared on the DTO.
- Errors: throw Nest exceptions (`BadRequestException`, `NotFoundException`, `ForbiddenException`); the frontend shows `error.message`.
- JSON is camelCase. Money is integer cents (`priceCents`), timestamps are `timestamptz`, and gym-local dates/times use `Europe/Sofia` (`attendance/attendance-timezone.util.ts`).

## How this repo relates to theindex-front
- The Angular app calls this API with relative URLs `/api/...` (`environment.apiUrl = '/api'`). In dev, `ng serve` proxies `/api` to `http://localhost:3000` (`proxy.conf.json` in the front repo). In prod, both images run from one `docker compose` on the VPS (`/opt/theindex`), and that compose setup routes `/api` to this container. The compose file is **not** in either repo.
- The front keeps hand-written TypeScript interfaces per resource in `src/app/services/*.service.ts`. If you change a route, DTO, response shape, enum value or JWT claim, update the matching front service/interface too, or tell the user it is needed.
- `CORS_ORIGIN` must include the front origin when it isn't served behind the same host.

## Rules
- **Don't modify `.github/workflows/` (deploy pipeline) or `Dockerfile` without asking first.** Every push to `main` builds the image, pushes it to GHCR and redeploys the production VPS over SSH.
- Don't push to `main`; work on a branch and open a PR.
- Entity changes alter the DB schema through `synchronize` (no migrations). Call out renames, drops and type changes explicitly, since they can lose data.
- Never commit `.env` or real secrets. Add new config keys to `.env.example`.
- Keep the module/DTO/guard patterns above. Add `*.spec.ts` next to pure logic you change (see `cash-register.service.spec.ts`, `attendance-time.util.spec.ts`).
- Run `npm run build` and `npm test` before pushing. Lint with the non-`--fix` command and don't let errors grow beyond the baseline. Keep reformat-only changes out of unrelated PRs.
