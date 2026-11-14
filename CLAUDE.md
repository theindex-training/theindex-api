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
Features: accounts (incl. self-registration and the Accounts page), article-categories, articles, attendance, cash-register, exercises, gym-locations, gym-subscriptions, media, my-profile, plans, public-content, schedules, settlements, subscriptions (incl. a daily cron in `subscriptions-cron.service.ts`, and `GET /api/subscription-renewals`, ADMIN/TRAINER: active trainees by PUNCH/TIME, exhausted vs still active, ranked by the pure `subscription-renewals.ts`), trainee-profiles, trainer-profiles, training-times, workouts.

`POST /api/attendance/batch/preview` (ADMIN/TRAINER, 200) takes the body of `POST /api/attendance/batch` and saves nothing: it answers what the batch would do, for the summary the front shows before saving. Per trainee: the subscription that would pay (the resolver's rule, repeated in the pure `attendance/attendance-preview.ts`; ATT-42 checks the two agree) and what is left afterwards. PUNCH: `remainingCreditsAfter`, summed over the trainee's active punch subscriptions. TIME: `endsAt` (the latest end of the active time subscriptions) and `daysLeft` (Europe/Sofia calendar days from now). `level` is `UNPAID`, `LAST` (no trainings left after this one, or ending today), `LOW` (up to 2 trainings or 7 days: `LOW_CREDITS`, `LOW_DAYS`) or `OK`, and rows come in that order, then by name. It fails like the batch does (trainer, trainees, location).

`media` stores every uploaded file, one row per item in the `media` table, and its `kind` (`media/media-kind.ts`) decides where the files go and who reads them:
- `ARTICLE_IMAGE`, images for the public site's articles (theindex-web `docs/decision-record.md`), in the **public** area: `MEDIA_STORAGE_DIR`, served by nginx at `MEDIA_PUBLIC_URL`.
- `WORKOUT_PDF`, the lesson plans workouts are imported from, in the **private** area: `MEDIA_PRIVATE_STORAGE_DIR`, which nothing serves (CrossFit's copyrighted material). Only the API streams them, behind a guard (`GET /api/workouts/source-pdfs/:id`).
- Each item's files are in `<kind folder>/<id>/` of its area (`article-images/…`, `workout-pdfs/…`); the row keeps the paths, so images uploaded before kinds existed stay under `<id>/`. Image-only columns (`altText`, `width`, `height`, `variants`, `ogPath`) are null for other kinds. To add a kind (e.g. profile photos), add it to `MEDIA_KINDS` with its area and folder, and let its owning feature decide who reads it.
- `POST /api/media` takes a multipart image (`file` + `altText`, ADMIN only). sharp turns it upright, strips its metadata (EXIF/GPS) and writes a master, WebP variants and a 1200×630 social preview; responses give URLs under `MEDIA_PUBLIC_URL`. The `/api/media` routes (the image library), `publicMedia` and article publishing see article images only.
- Documents (`MediaService.storeDocument` / `openDocument`) are stored as uploaded, once per file (by `sha256`).
- Settings are read on first use, each area on its own: without them in production, that area's requests answer 503 but the API still starts. `MEDIA_PRIVATE_STORAGE_DIR` must be outside `MEDIA_STORAGE_DIR`. In development the API serves `./media-storage` at `/media-files`; `./media-storage-private` is never served.

`article-categories` are the public site's article categories (ADMIN CRUD at `/api/article-categories`). The slug comes from the name through `common/utils/slug.util.ts` unless the admin chooses one, and renaming keeps it. Unique indexes on `(language, slug)` and `(language, nameKey)` (the lowercased name, never returned) decide clashes, concurrent ones included (409). A slug is fixed while a published article uses the category. Only categories with a published article are public (see `public-content`).

`articles` are the public site's articles (ADMIN at `/api/articles`). Each row has a **published version** (columns, empty until the first publish) and a **working copy** (`draft` jsonb) that autosave (`PATCH /api/articles/:id/draft`) writes to, so half-written text never goes live. A save names the `draftRevision` it is based on and is applied with a conditional `UPDATE` that merges only the sent fields into the stored draft (`"draft" || :changes`), so a stale tab or a concurrent save gets 409 (with `currentRevision`) and a change made to other fields meanwhile is never written back over. The body is Editor.js JSON, checked and sanitized by `articles/article-content.ts` (allowlisted blocks; inline HTML cut down to `b`, `i`, `a[href]`, `br`; images and YouTube stored as `mediaId`/`videoId`). JSON bodies may be up to 1 MB (`common/http/body-limit.ts`, set in `main.ts` and the e2e app).

The lifecycle is in `articles/article-publishing.service.ts`, and each step locks the article row:
- `POST /:id/publish` with the `baseRevision` the admin is looking at (409 if stale): checks the rules for going live (title, content, images, featured image and categories that still exist; otherwise a 400 listing every problem), sets the slug at the first publish (the chosen one, or from the title made unique, never `category`, fallback `statia`; fixed after that), copies the draft over the published version, saves `plainText`, and replaces the `article_category_links` (the **published** categories).
- `POST /:id/unpublish` keeps the published version, so the article can go back up.
- `POST /:id/discard-draft` (with `baseRevision`) puts the published version back into the draft.
- `DELETE /:id` is permanent, and refused (409) while the article is published.
- In `article-categories`, a category's slug is fixed while a published article uses it, and deleting a category drops it from links and drafts.
- `POST /:id/preview-token` gives a 30-minute token for the site's draft preview (`articles/preview-token.ts`). It is a JWT signed with a key derived from `JWT_SECRET` for this purpose, with its own audience, so it never works as a login token and a login token never works as a preview token.

`public-content` is what the public site (theindex-web) reads, under `/api/public/...` with **no guard**, in its own controllers so a missing guard elsewhere can't expose drafts. Every query in `public-content.service.ts` starts from `PUBLISHED` articles of the language and returns the published version only, shaped by the pure helpers in `public-content.ts` (no ids, drafts, revisions, account ids or file names; image blocks resolved to URLs through `MediaService.publicMedia`, and dropped if the image is gone; excerpt and SEO fallbacks):
- `GET /public/articles?category&q&page&pageSize`: summaries, newest first publish first (an update doesn't move an article); `category` is a slug, `q` searches title, excerpt and `plainText` with `ILIKE` (wildcards escaped by `common/utils/like.util.ts`). `{ items, total, page, pageSize }`, page size 12 by default, up to 50.
- `GET /public/articles/:slug`: one article with its blocks, featured image and published categories; 404 unless published.
- `GET /public/article-categories` and `/:slug`: categories with at least one published article and their `articleCount`; 404 otherwise.
- `GET /public/sitemap`: article and category slugs with `lastmod`.
- `GET /public/preview?token=`: the current draft of the token's article, any status (`no-store`, `noindex`); 401 for a bad or expired token.

`schedules` are the gyms' weekly training schedules (`schedules/`):
- A gym's **template** (`schedule_template_slots`, ADMIN changes it, TRAINER reads it) is its usual week: slots of a weekday (1 = Monday ... 7 = Sunday), a training time (`training_times`) and a trainer. `GET /api/schedule-templates/:gymId`, `POST /api/schedule-templates/:gymId/slots`, `PATCH`/`DELETE /api/schedule-templates/slots/:id`.
- A **week** (`schedule_weeks`, one per gym and Monday) is created on purpose by ADMIN or TRAINER with `POST /api/schedules` `{ gymId, week }` (any day of the week): every template slot becomes a dated slot (`schedule_slots`), past days included, with the day's workout when the day has exactly one (none when it has several: `onlyWorkoutByDay` in `schedule-week.ts`; workouts added later aren't linked). Never automatically. 400 for a week that is over (after its Sunday) or a gym without a template, 409 when it exists. From then on the week and the template are independent.
- A new week is a **draft** (`status`, `schedules/enums/schedule-week-status.enum.ts`): staff see and change it like any week, trainees don't see it at all (the bookings routes treat it as not created: `week: null`, 404 `Training not found` for its trainings, booking included). `POST /api/schedules/:weekId/publish` (200, the week as `GET` gives it) makes it `PUBLISHED` for good, with `publishedAt` and `publishedByAccountId` (409 when it already is). `DELETE /api/schedules/:weekId` discards a draft with its trainings, so it can be created again (409 for a published week). The column defaults to `PUBLISHED`, so the weeks created before drafts existed stayed published (their `publishedAt` is null); new weeks are created as `DRAFT` explicitly.
- `GET /api/schedules?gymId&week` gives `{ gym, weekStart, weekEnd, editableFrom, week, slots }`, `week` being `{ id, createdAt, status, publishedAt }`; `week` is null (and `slots` empty) until created. `POST /api/schedules/:weekId/slots`, `PATCH`/`DELETE /api/schedules/slots/:id` change a week; **today and earlier days are read-only** (`editableFrom` is tomorrow, gym-local). A week slot may name a `workoutId` of the same day (null removes it; deleting the workout clears it). The day of a slot never changes.
- `GET /api/schedules/slots/:id` (ADMIN, TRAINER) is one training for staff: the week slot's fields, its whole `workout` (as trainees get it from `GET /api/bookings/trainings/:slotId`, plus its `id`; both use `trainingWorkout` in `schedules.service.ts`), `gym`, `weekStart`, `startsAt` and `trainees`, who booked it, each with `isActive`, `bookedAt` and what is left of their subscriptions (pure `schedules/training-bookings.ts`). Until attendance is saved for the training (`attendanceSaved: false`) the figures are a **projection**: the attendance preview's rule (`attendance/attendance-preview.ts`) with the training's start as `trainedAt`, so `remainingCredits` is after this training and a TIME period ending before it is `UNPAID`. Attendance counts as saved for the training when a row has the same trainee, gym and `trainedAt` = the start (what Register attendance saves when opened from the training); then the figures are what is left now and `paymentStatus` is the saved one. Rows come in the preview's order (`UNPAID`, `LAST`, `LOW`, `OK`, then by name).
- A slot's training time is `trainingTimeId`, or `trainingTime: { startTime, endTime }`: a training time with those hours is reused, otherwise created. Several slots may share a day, time and gym (different trainers). Trainers newly put on a slot must be active. Slots are ordered by day, start, end and trainer name (pure `schedule-week.ts`).
- **Bookings** (`schedule_bookings`, one per trainee and week slot; TRAINEE only, always their own, the profile id from the token): `GET /api/bookings/gyms` (active gyms), `GET /api/bookings/schedule?gymId&week` (the week with each training's `bookedCount`, `bookedByMe`, `canBook`, `canCancel`, `bookingClosesAt`, `cancelUntil`; never who booked; a workout by its title only), `GET /api/bookings/trainings/:slotId` (one training of an active gym, booked or not, with its `gym` and its whole `workout`: `title`, `summary` and `exercises` in order with `name`, `description` and `videoUrl`; never the source PDF; 404 `Training not found`), `POST /api/bookings` `{ slotId }` (409 when already booked), `DELETE /api/bookings/:slotId` (cancels: the row is deleted). A training's workout reaches trainees only once its day's workouts are **out**: from 20:00 gym-local the day before (past days, today, and tomorrow after 20:00; pure `schedules/workout-release.ts`). Until then `workout` is null, as if none were chosen, in the week, the training and the book/cancel answers; every trainee slot carries `workoutReleasesAt`. It is computed from the clock, not a stored flag, so nothing runs at 20:00 (a future announcement job, e.g. Instagram stories or in-app notifications, can use the same `workoutReleasesAt` and record what it announced). Staff always see every workout. Booking opens when the week is published and closes 30 minutes before the training starts; a booking can be cancelled until 1 hour before (pure `booking-rules.ts`, gym-local start times). Inactive trainees can't book. A booking says who plans to come, not who came: attendance stays separate. Staff see `bookedCount` on every week slot; a slot with bookings can't be removed or moved to another training time (409), while its trainer and workout can change.
- Training times and trainers a schedule uses can't be deleted (`RESTRICT`; a training time answers 409), and a training time a schedule uses keeps its hours (`PATCH /api/training-times/:id` with other hours answers 409: add a new one), since schedules show the hours of the row they point to. Moving a workout to another day takes it off the week slots that named it. Deleting a gym deletes its template and weeks.

Home gyms: a trainee profile's optional `preferredGymId` and a trainer profile's optional `primaryGymId` (create/update; an active gym, 400 `Unknown gym` / `Gym is inactive`; null clears it; deleting the gym clears it, `SET NULL`; `gym-locations/home-gym.util.ts`) are the default gym of their pages in the front. Trainers read theirs with `GET /api/trainers/:id` (their `trainerProfileId`); trainees get it as `preferred: true` in `GET /api/bookings/gyms`.

**Accounts and self-registration** (`accounts/`, `auth/`, `my-profile/`):
- `POST /api/auth/register` (public) lets anyone create their own account: `email`, `password` + `confirmPassword`, `name`, `phone` (`common/utils/contact.util.ts`: 6 to 15 digits, optional `+`), optionally `gymSubscriptionId`, `preferredGymId` (active ones, listed by the public `GET /api/auth/register/options`) and `instagram`/`facebook`/`tiktok` (a handle or a link, as typed), and `acceptTerms: true` (agreeing to the use of personal data and to receiving emails; anything else is 400). The account is a TRAINEE with no profile, its email trimmed and lowercased (409 when any account has it, in any case), `hasUpdatedInitialPassword: true`; what was entered is kept in `accounts.registration` (jsonb) and the agreement time in `consentAt`. The answer is the sanitized account, no token.
- Login: a non-ADMIN account must be connected to a profile **on the account side** (`traineeProfileId`/`trainerProfileId`), else 403 `NOT_LINKED_MESSAGE` (`auth.service.ts`; only after the right password). The email lookup is exact first, then ignores case and surrounding spaces when exactly one account matches.
- The admin's Accounts page (`account-admin.service.ts`, ADMIN only): `GET /api/accounts?link=unlinked|linked|all&search` (default `unlinked`: not connected, admins excluded; newest first; views from the pure `account-view.ts`, registration gyms by name), `GET /api/accounts/:id/details`, `POST /api/accounts/:id/link` (200; `{ profileType: 'trainee'|'trainer', profileId?, name, nickname?, phone?, gymSubscriptionId? (trainees), homeGymId?, instagram?, facebook?, tiktok? }`: connects to an existing **active** profile without an account, or creates one when `profileId` is left out; the profile stores what the admin sent, a field left out keeps its value; the account takes the profile's role) and `DELETE /api/accounts/:id/permanent` (only an account connected on neither side; never an admin; 409 otherwise). Declared before `POST /accounts/:profileType/:profileId`, which would match `/:id/link` too.
- "My details": `GET`/`PATCH /api/my-profile` (TRAINEE, TRAINER; always their own, read from the account in the DB): `{ profileType, email, name, phone, gymSubscriptionId, homeGymId, instagram, facebook, tiktok, consentAt }`. They change `phone` (never cleared), `gymSubscriptionId` (trainees only; 400 for trainers), `homeGymId` (preferred / primary gym) and the social links; never the name, the email or the nickname.
- **The nickname is internal to staff**: trainees never see or set it. Keep it out of every response a trainee gets (`/my-profile`, `/bookings`, the trainee-scoped attendance and subscription lists).
- Trainee and trainer profiles have `instagram`, `facebook`, `tiktok` (varchar 200, null) and trainers a `phone`; staff set them on the create/update DTOs too.

`exercises` and `workouts` are the workouts of the day (WOD), for ADMIN and TRAINER. Trainees see a training's workout (summary, exercises with descriptions and videos) only through `GET /api/bookings/trainings/:slotId`, never the workouts routes. Kept deliberately simple: a workout is its text plus the list of exercises it uses.

- `exercises` (`/api/exercises`): the movement catalogue: `name`, `aliases` ("other names"), optional `description` (never pre-filled: trainers write it) and `videoUrl`, and `isActive`. A name and its aliases share one namespace of keys (`exercises/exercise-key.ts`: lowercase, hyphens and plurals dropped, `KB` → kettlebell), so "Pull-ups" can't be added beside "Pull-up" (409) and the PDF import finds a movement by any spelling. Any common YouTube link form is accepted and stored as `https://www.youtube.com/watch?v=<id>` (`exercises/youtube-url.ts`); other links get 400, and empty or null removes either field. `POST /api/exercises/:id/aliases` `{ alias }` adds another spelling (e.g. a lesson plan's) without touching the others; one the exercise already answers to changes nothing, one another exercise answers to is 409. An exercise a workout uses can't be deleted (409), only made inactive (hidden from new workouts; old ones keep showing it).
  - On boot, an **empty** table gets the starter library (`exercise-library.ts`): the 118 movements of crossfit.com's A–Z list (https://www.crossfit.com/crossfit-movements, read 2026-11-10), named as there without the leading "The", each with the YouTube video embedded on its page; plus 42 of the gym's own movements without a video (Run, Bike, Plank, Rest, scaled versions...) that the lesson plans use. Aliases carry the spellings the PDF import must find (a plain "Pull-up" is the Kipping Pull-up). To re-seed, empty the table: `TRUNCATE "exercises" CASCADE` (it also empties `workout_exercises`).
- `workouts` (`/api/workouts`, `?from&to` for a date range, by day and then as created): `date` (gym-local day; several workouts may share one, e.g. regular groups, competitors, skills; nothing tells them apart but the name), optional `title`, the required **`summary`** (plain text, up to 3000 characters; line breaks are kept and matter: the DTO only normalizes `\r\n`, trailing spaces and runs of empty lines) and `exerciseIds`, the exercises it uses, in order, each once, optional (table `workout_exercises`, `position`). Responses give `exercises: [{ id, name, videoUrl, isActive }]`. `PATCH` changes the fields sent; `exerciseIds` replaces the list.
- `POST /api/workouts/import-pdf` (multipart `file`) reads a CrossFit lesson-plan PDF into a draft for the form, and **saves no workout**: `{ sourceCode, date, title, summary, exercises: [{ name, exerciseId, exerciseName }], sourcePdf, warnings }`. Once the PDF has been read it is kept as a private `WORKOUT_PDF` media item (the same file once); `sourcePdf` is `{ id, originalFilename, sizeBytes, uploadedAt }`, or null with a warning when the private area isn't configured. Only the band at the top is read, and of it only the heading and the **RX** column; the other columns are ignored:
  - `import/pdf-text.ts` gets the first page's text with positions from pdf.js (`pdfjs-dist`, ESM-only, loaded with `import()` on first use).
  - `import/sheet-layout.ts` (pure) finds the heading and the four columns; it also drops the repeated and shifted copies of the text some of these PDFs carry.
  - `import/lesson-plan.ts` (pure): the day and name from the heading, the RX column as the summary (as printed, a line per line, wrapped lines joined) and the movements it names (`movementsInLine`: amounts, loads, EMOM minutes and remarks stripped; headings, rep schemes and remarks name none).
  - `import/workout-import.service.ts` matches the movements to exercises by name or alias; one the catalogue lacks comes back with `exerciseId: null`, and the form creates it or links it to an existing exercise (adding the spelling as an alias).
  - The lesson plans are CrossFit's copyrighted material: don't commit them, and never put them in the public media area. Tests build their own PDFs (`test/int/pdf-fixture.ts`).
- A workout's `sourcePdfId` (create/update; null removes it) names the PDF it was imported from, for reference: its fields may have been edited since, and several workouts may share one. It must be a stored `WORKOUT_PDF` (400 `Unknown source PDF` otherwise). Responses give `sourcePdf` (as above) or null. Deleting a workout keeps the PDF; nothing deletes kept PDFs yet, including ones imported but never saved with a workout.
- `GET /api/workouts/source-pdfs/:id` (ADMIN, TRAINER) streams a kept PDF, saved with a workout or just imported: `application/pdf`, inline under its original name, `Cache-Control: private, no-cache`. 404 for an id that isn't a workout PDF.
- A follow-up will add workouts for records (e.g. "Fran" for time, a back squat for load, an AMRAP for rounds and reps), unrelated to these: their score kinds will be a fixed enum, not managed types.

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
