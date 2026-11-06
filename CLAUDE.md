# theindex-api

REST backend for The Index, a CrossFit gym app covering attendance, plans/subscriptions, settlements and the cash register. The frontend lives in the sibling repo `theindex-training/theindex-front`.

## Stack
- NestJS 12, TypeScript 6 (`module: nodenext`), Node 24 LTS (`.nvmrc`, Docker image `node:24-alpine`)
- The app is CommonJS. Nest 12 packages are ESM-only and load through Node's `require(esm)`, so the runtime must stay on Node ≥ 22.12 (24 in practice). TS 6 defaults `strict` to true and `types` to `[]`; `tsconfig.json` sets `strict: false` and `types: ["node", "jest"]` explicitly to keep the previous checks.
- PostgreSQL through TypeORM 0.3 (`autoLoadEntities`; schema is managed by `synchronize` when `DB_SYNC=true`. There are **no migrations**)
- Auth: Passport local (login) + JWT bearer (`@nestjs/jwt`, `passport-jwt`), bcrypt password hashes
- Validation: `class-validator`/`class-transformer`; docs: `@nestjs/swagger`
- Tests: Jest 30 + ts-jest, supertest for e2e. Jest can only load the ESM-only Nest packages with `--experimental-vm-modules`, so every `test*` script starts it as `node --experimental-vm-modules ./node_modules/jest/bin/jest.js` (an IDE runner needs `NODE_OPTIONS=--experimental-vm-modules`). supertest is pinned to `~7.2.2`: 7.3.x breaks the e2e suites ("Cannot read properties of null (reading 'address')").
- Lint: ESLint 10 flat config (`eslint.config.mjs`) + typescript-eslint + prettier

## Commands
```bash
npm ci                      # install (lockfile is committed; CI/Docker use npm ci)
cp .env.example .env        # local config: needs a running Postgres
npm run start:dev           # watch mode on :3000
npm run build               # nest build -> dist/
npm run start:prod          # node dist/main
npm test                    # unit tests (src/**/*.spec.ts), DB-free
npm run test:int            # service integration tests (src/**/*.int-spec.ts) against Postgres DB `theindex_test` (TEST_DB_* in .env.example); drops its schema
npm run test:e2e            # test/*.e2e-spec.ts: boots AppModule, needs Postgres (DB_* + JWT_SECRET); close the app in afterAll or the cron timer keeps Jest alive
npm run test:tz-sofia       # DT-06: *.sofia-spec.ts / *.sofia-int-spec.ts under TZ=Europe/Sofia (needs the TEST_DB_* Postgres); not in CI yet
npm run lint:check          # lint without modifying files; fails on any error or warning (CI gate)
npm run lint                # NOTE: runs eslint --fix and rewrites files
npm run format              # prettier --write
```
Local Postgres matching `.env.example`: user/pass/db `theindex`, port 5432. On boot, `BootstrapService` seeds an ADMIN account from `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` (`admin`/`admin` in the example). Swagger UI is at `http://localhost:3000/api/docs`. `tests.md` has a manual curl scenario for the whole domain.

Known baseline (as of Nov 2026): build passes, all unit, integration and e2e tests pass, and `npm run lint:check` is clean (0 errors, 0 warnings). CI fails on any new lint error or warning.

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
  common/utils/         # shared pure helpers (+ *.spec.ts), e.g. slug.util.ts: Latin URL slugs for public content
  bootstrap/            # seeds the admin account on startup
test/                   # e2e specs + jest-e2e.json
```
Features: accounts, article-categories, articles, attendance, cash-register, gym-locations, gym-subscriptions, media, plans, settlements, subscriptions (incl. a daily cron in `subscriptions-cron.service.ts`), trainee-profiles, trainer-profiles, training-times.

`media` holds images for the public site's articles (theindex-web `docs/decision-record.md`). `POST /api/media` takes a multipart upload (`file` + `altText`, ADMIN only). sharp turns it upright, strips its metadata (EXIF/GPS) and writes a master, WebP variants and a 1200×630 social preview under `MEDIA_STORAGE_DIR/<id>/`; responses give URLs under `MEDIA_PUBLIC_URL`. Settings are read on first use: without them in production, media requests answer 503 but the API still starts. In development the API serves `./media-storage` at `/media-files`.

`article-categories` are the public site's article categories (ADMIN CRUD at `/api/article-categories`). The slug comes from the name through `common/utils/slug.util.ts` unless the admin chooses one, and renaming keeps it. Unique indexes on `(language, slug)` and `(language, nameKey)` (the lowercased name, never returned) decide clashes, concurrent ones included (409). A slug is fixed while a published article uses the category. The public endpoints come with the articles (theindex-web backlog item 7).

`articles` are the public site's articles (ADMIN at `/api/articles`). Each row has a **published version** (columns, empty until the first publish) and a **working copy** (`draft` jsonb) that autosave (`PATCH /api/articles/:id/draft`) writes to, so half-written text never goes live. A save names the `draftRevision` it is based on and is applied with a conditional `UPDATE`, so a stale tab or a concurrent save gets 409 (with `currentRevision`). The body is Editor.js JSON, checked and sanitized by `articles/article-content.ts` (allowlisted blocks; inline HTML cut down to `b`, `i`, `a[href]`, `br`; images and YouTube stored as `mediaId`/`videoId`). JSON bodies may be up to 1 MB (`common/http/body-limit.ts`, set in `main.ts` and the e2e app).

The lifecycle is in `articles/article-publishing.service.ts`, and each step locks the article row:
- `POST /:id/publish` with the `baseRevision` the admin is looking at (409 if stale): checks the rules for going live (title, content, images, featured image and categories that still exist; otherwise a 400 listing every problem), sets the slug at the first publish (the chosen one, or from the title made unique, never `category`, fallback `statia`; fixed after that), copies the draft over the published version, saves `plainText`, and replaces the `article_category_links` (the **published** categories).
- `POST /:id/unpublish` keeps the published version, so the article can go back up.
- `POST /:id/discard-draft` (with `baseRevision`) puts the published version back into the draft.
- `DELETE /:id` is permanent, and refused (409) while the article is published.
- In `article-categories`, a category's slug is fixed while a published article uses it, and deleting a category drops it from links and drafts.

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
- Keep the module/DTO/guard patterns above. Add `*.spec.ts` next to pure logic you change (see `attendance-time.util.spec.ts`; service tests go in `*.int-spec.ts`, e.g. `cash-register.service.int-spec.ts`).
- Run `npm run build`, `npm run lint:check` and `npm test` before pushing. Keep reformat-only changes out of unrelated PRs.

## Testing rules (characterization tests)
We are adding characterization tests to a production API. `TEST_PLAN.md` lists what to cover and tracks progress per module. `TEST_NOTES.md` logs behavior that looks unintended.

- **Current production behavior is the spec.** Tests describe what the code DOES, not what it should do.
- **Never change production code to make a test pass.** If behavior looks like a bug, test the current behavior, add a `// CHARACTERIZATION: possibly unintended` comment on the test, and log it in `TEST_NOTES.md` with an explanation.
- **Test through public interfaces**: service methods and HTTP endpoints, not private internals. No `(service as any).privateMethod`, no spying on private methods.
- **Mock only at boundaries** (database, external HTTP, time/dates). Never mock the code under test. Don't mock collaborators inside the app (e.g. `CashRegisterService` when testing `SubscriptionsService`).
- **Every test must fail if the business rule it covers is broken.** No tests that only check a function was called. Assert on outcomes: returned values, persisted rows, HTTP status and body, balances.
- **When fixing a bug in future**: first add a failing test that reproduces it, then fix it. Update the matching characterization test and `TEST_NOTES.md` entry in the same PR.
- **Tests must pass in CI before any deploy.** `docker-ghcr.yml` has a `lint` job (`npm run lint:check`) and a `test` job (Postgres 16 service; build, `npm test`, `npm run test:int`, `npm run test:e2e`). Both run on every push to `main` and on every PR. `build-api` and `deploy` need both and are skipped on PRs. A red lint or test job blocks the production deploy. Changing the workflow still needs the owner's approval (see Rules above).

`TEST_NOTES.md` entry format:
```
## <module>: <one-line behavior>
- Test: `<spec file>` > `<test name>`
- Current behavior: ...
- Why it looks unintended: ...
- Impact / who would notice: ...
```

Practical notes for writing tests (details in `TEST_PLAN.md` § Test infrastructure):
- Pin the process timezone (`TZ=UTC`) for every Jest run. Several date helpers use server-local time, so results depend on `TZ`.
- Run Jest on the Node version in `.nvmrc` (24), the version CI and production use. `Intl` date formatting differs between Node/ICU versions: a midnight bug (`hour12: false` → hour 24) passed on Node 22 and only failed in CI on Node 20. With `Intl.DateTimeFormat`, set `hourCycle: 'h23'` explicitly instead of `hour12: false`.
- Freeze "now" by faking **only `Date`**: `jest.useFakeTimers({ now, doNotFake: [every API except 'Date'] })`. Faking `setTimeout`/`nextTick` breaks the `pg` driver and Nest. DB-generated `createdAt` still uses the DB clock (and is identical for rows inserted in one transaction).
- Code that uses QueryBuilder, raw SQL, `AT TIME ZONE` or row locks must be tested against a real Postgres test database, not mocked repositories.
- e2e apps must apply the same setup as `main.ts` (`setGlobalPrefix('api')`, the same `ValidationPipe` options). `AppModule` alone doesn't include them.
