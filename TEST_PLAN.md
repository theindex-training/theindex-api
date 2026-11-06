# Characterization Test Plan: theindex-api

Covers every piece of business logic in `src/` as of commit `86cd3a8` (Nov 2026). The rules for writing tests are in `CLAUDE.md` § Testing rules. In short: **current behavior is the spec**, don't touch production code, test through services and HTTP, mock only DB/HTTP/time, and every test must fail if its rule breaks.

## How to use this file

- `- [ ]` on a **module heading** = module done (all its P0/P1 cases written and green). Tick individual cases as you go.
- Case IDs (`SET-05`) are stable. Reference them in test names, e.g. `it('SET-05 splits PUNCH paidCents across initialCredits', ...)`.
- Layer tags:
  - **[U]** unit, no DB. Pure functions and guards.
  - **[I]** service integration against a real Postgres test DB, via a Nest `TestingModule`.
  - **[E]** HTTP e2e with supertest against the full `AppModule` (configured like `main.ts`) + real Postgres.
- Priority inside a module: **P0** must have, **P1** should have, **P2** nice to have.
- ⚠ **Suspect** = current behavior looks unintended. Write the test to assert the *current* behavior, put `// CHARACTERIZATION: possibly unintended` above it, and add an entry to `TEST_NOTES.md` (format in `CLAUDE.md`). Don't fix it in the same PR.
- "Assert" lists what the test must check so it fails when the rule breaks. Assert on outcomes: return values, DB rows, HTTP status/body, balances. Never just "was called".

## Risk ranking

Risk = how much damage a regression does × how likely a change is to break it.

| # | Module | Risk | Why | Main layer |
|---|---|---|---|---|
| 1 | Settlements | **P0** | Computes trainer payouts and takes money out of the cash register. Complex rounding/ordering/TIME-pending rules. | I, E |
| 2 | Subscriptions (purchase, reconciliation, delete, resolver) | **P0** | Money in, credit balances, retroactive payment of unpaid attendance. | I, E |
| 3 | Attendance write path (create, batch, delete) | **P0** | Consumes/restores credits; decides PAID vs UNPAID. | I, E |
| 4 | Cash register | **P0** | Running balance, non-negative invariant, idempotency. | I, E |
| 5 | Auth + access control (login, JWT, RolesGuard, per-route roles, trainee scoping) | **P0** | One decorator edit can expose money/admin routes. JWT claims are a cross-repo contract. | U, E |
| 6 | Accounts | **P0** | Passwords, provisioning, account disable; TRAINER can currently act on ADMIN accounts. | I, E |
| 7 | Date/time utilities | **P1** | Underpin attendance timestamps, settlement periods, reports. Timezone-sensitive. | U |
| 8 | Attendance read path (dates, sessions + price info, reports) | **P1** | Shown to staff; price info mirrors settlement math. | I |
| 9 | Plans | **P1** | Plan shape feeds subscription credits/duration. | I, E |
| 10 | Trainee profiles (CRUD, linking, overview, insights) | **P1** | Search is broken today; link inconsistencies affect JWT claims. | I, E |
| 11 | Subscriptions cron | **P1** | Daily status change of TIME subscriptions. | I |
| 12 | Trainer profiles | **P2** | Simple CRUD; open read access. | I, E |
| 13 | Training times | **P2** | Simple CRUD; used by session grouping. | I, E |
| 14 | Gym locations / gym subscriptions | **P2** | Simple CRUD with soft delete. | I, E |
| 15 | Bootstrap + app/health | **P2** | Startup seeding. | I, E |

**Suggested execution order** (differs from risk on purpose): Phase 0 infra → §7 date utils (cheap, no DB, everything else depends on them) → §5 role matrix → §1–4 → §6 → the rest.

---

## Phase 0: Test infrastructure

- [x] **Phase 0 done** (INF-01–11)

- [x] **INF-01** Test database (done: `test/int/test-app.ts`, `TEST_DB_*` env vars, refuses names not ending in `_test`, `dropSchema` per suite). Use a dedicated Postgres DB (e.g. `theindex_test`), never the dev DB. Use `synchronize: true` and `TRUNCATE ... RESTART IDENTITY CASCADE` on all tables between tests. Locally: `docker run postgres:16`. In CI: a service container.
- [x] **INF-02** Jest layout (done: `test/jest-int.json`, `npm run test:int`; e2e scripts unchanged apart from `TZ=UTC`):
  - Keep `npm test` DB-free: `src/**/*.spec.ts` = [U] only.
  - Add an integration config for `*.int-spec.ts`. Note the current `testRegex` `.*\.spec\.ts$` does *not* match `.int-spec.ts`.
  - e2e stays in `test/*.e2e-spec.ts`.
  - Add npm scripts `test:int` and `test:e2e`. Use `--runInBand` for DB suites.
- [x] **INF-03** Pin timezone: run every Jest command with `TZ=UTC` (script prefix). UTC is what the `node:24-alpine` image uses unless compose overrides it; see Q1. Add a guard test that fails if `new Date(2025, 0, 1).getTimezoneOffset() !== 0`, so a misconfigured run fails loudly instead of producing wrong expectations. **Also run Jest on the `.nvmrc` Node version** (24 since Nov 2026; same as CI and the production image). `Intl` output can differ between Node/ICU versions, which is how the DT-01 midnight bug passed locally on Node 22 and only failed in CI.
- [x] **INF-04** Clock helper. `freezeTime(iso)` = `jest.useFakeTimers({ now, doNotFake: [everything except 'Date'] })`. Fake only `Date`: faking `setTimeout`/`nextTick` breaks the `pg` driver and Nest. "now" in this codebase always comes from JS `new Date()`, never SQL `now()`, so this controls all business time. Exception: `@CreateDateColumn` values come from the DB clock, and Postgres `now()` is the *transaction start*, so rows inserted in one transaction share `createdAt`.
- [x] **INF-05** Data builders. Create trainers, trainees, locations, plans, subscriptions and attendance. Prefer the real services, e.g. `SubscriptionsService.createForTrainee`, so setup follows real rules. Insert directly via repositories only for states the API can't produce (e.g. `EXPIRED` status). Give every attendance a **distinct `trainedAt`** unless the test is about ties: ordering ties fall back to `createdAt`, which is identical inside one transaction. Suites that need more modules pass `setupIntegrationSuite({ extraImports })`; `test/int/auth-setup.ts` has `authImports()` (AuthModule + AccountsModule with a fixed test `JWT_SECRET`) and `decodeVerifiedJwt()`. Reach other services with `fx.moduleRef.get(...)`.
- [x] **INF-06** e2e app factory (done: `test/e2e/e2e-app.ts` `createE2eApp()` / `setupE2eSuite()`: `main.ts` setup, refuses a `DB_NAME` not ending in `_test`, truncates all tables and re-runs the real admin seed before each test, closes the app in `afterAll`; `test:e2e` now runs `--runInBand` and the e2e config loads the TZ guard. `test/app.e2e-spec.ts` still builds its own app; it doesn't touch the DB). Build `AppModule` and then apply the same setup as `main.ts`: `setGlobalPrefix('api')` and `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`. `main.ts` isn't exported, so the setup is duplicated in the test (see Q4). Always `await app.close()` in `afterAll`. That runs `SubscriptionsCronService.onModuleDestroy`, clears the cron timer, and removes the need for `--forceExit`. Set `JWT_SECRET` *before* compiling: `JwtStrategy` reads `process.env.JWT_SECRET` in its constructor.
- [x] **INF-07** Auth helpers (done in `E2eContext`: `loginAs`, `loginAsAdmin`, `provisionAndLogin(profileType, profileId)` through the real admin provisioning route, and `signToken(payload)` via the app's `JwtService`):
  - `loginAs(email, password)` through `POST /api/auth/login`. Seed the admin through `SEED_ADMIN_EMAIL/PASSWORD`, so the real `BootstrapService` runs.
  - `signToken(payload)` with the same secret, for payload edge cases (TRAINEE with `traineeProfileId: null`, TRAINER without `trainerProfileId`).
- [x] **INF-08** Fix stale baseline tests. `src/app.controller.spec.ts` and `test/app.e2e-spec.ts` expect `'Hello World!'`, but production returns `'Hello TheIndex!'`. Update the expectations, since current behavior is the spec. The e2e must also use `/api`. This is a test-only change.
- [x] **INF-09** Replace `src/cash-register/cash-register.service.spec.ts`. It spies on the private `applyTransaction` and only checks it wasn't called, which breaks two rules. Replace it with CR-07 [I], which asserts on rows and balance.
- [x] **INF-10** CI gate (approved by the owner; done in `docker-ghcr.yml`: `lint` + `test` jobs on every PR and push to `main`; `build-api` and `deploy` need both. Lint gate added Nov 2026 after the 36 baseline errors were fixed: `npm run lint:check`, `--max-warnings 0`). Proposal:
  - Add a `test` job: Postgres service, `npm ci`, build, lint (non-fix, `npm run lint:check`, now a separate `lint` job), `test`, `test:int`, `test:e2e`, all with `TZ=UTC`.
  - Make `build-api` `needs: test`.
  - Also run it on `pull_request`.
- [x] **INF-11** New test files must pass `npm run lint:check` (0 errors, 0 warnings since Nov 2026; enforced in CI).

---

## 1. Settlements: P0
- [x] **Module done** (service layer: `settlements.service.int-spec.ts`; HTTP: `test/e2e/settlements.e2e-spec.ts`, SET-03, SET-35, SET-40–43)
- [x] **Service layer done** (`settlements.service.int-spec.ts`).

Code: `settlements/settlements.service.ts`, `settlements.controller.ts`, `settlement-allocation.util.ts`.

Settlements take attendance in a period and create one **allocation** per attendance (value in cents + reason) and one **line** per trainer (sum). Finalizing takes the total out of the cash register.

### Generate
- [x] **SET-01** [I] P0. Period with no attendance:
  - Assert a DRAFT settlement is persisted with `periodStart/End` as given.
  - Assert the response is `{ settlement, lines: [], info: { message: 'No attendance in period' } }` (different `info` shape from the non-empty case) and there are 0 allocation/line rows.
- [x] **SET-02** [I] P0. Period boundaries are computed by `getLocalDateInterval` in **server-local TZ** (UTC under INF-03): `[periodStart 00:00, periodEnd+1 00:00)`.
  - Assert attendance at `periodStart T00:00:00.000Z` is included.
  - Assert `periodEnd T23:59:59.999Z` is included.
  - Assert `periodEnd+1 T00:00:00.000Z` is excluded.
  - ⚠ Suspect: gym-local time is Europe/Sofia everywhere else. An attendance at 2025-12-01 01:00 Sofia (= 2025-11-30 23:00Z) falls in the *November* settlement, not December.
- [x] **SET-03** [E] P1. Period validation:
  - Assert `periodStart > periodEnd` → 400 `from must be <= to`.
  - Assert `periodStart == periodEnd` → 201 (one-day period).
  - Assert a non-`YYYY-MM-DD` value → 400 (DTO).
  - ⚠ Suspect: `2025-02-30` passes the DTO and `getLocalDateInterval` rolls it over, but the raw string then fails the Postgres `date` insert. **Observed: 500** (not the silent rollover this line first predicted), nothing persisted. See TEST_NOTES.
- [x] **SET-04** [I] P0. UNPAID attendance:
  - Assert the allocation has `valueCents 0`, `reason UNPAID`, `subscriptionId null`, `subscriptionType null`.
  - Assert it counts in `info.unpaidAttendance` and `line.unpaidAttendanceCount`.
  - Same for a PAID row whose `subscriptionId` is null (only reachable via direct insert; P2).
- [x] **SET-05** [I] P0. PUNCH value = `splitCents(paidCents, initialCredits)`. It's divided by the credits *bought*, not the credits used.
  - Example: 10000 cents, 3 credits, 2 used. Assert values 3334 and 3333, assert the 1st attendance by `(trainedAt, id)` gets the extra cent, and assert the total allocated is 6667 (the unused credit's 3333 is never allocated).
- [x] **SET-06** [I] P0. PUNCH index is **global per subscription**, ordered by `trainedAt ASC, id ASC` over all its PAID attendances, including those outside the period.
  - Example: sub 10000/3, attendances on Nov 10 and Dec 5. Assert the December settlement allocates 3333 (index 1), not 3334.
- [x] **SET-07** [I] P0. TIME subscription not yet ended (`endsAt > generatedAt`):
  - Assert each in-period allocation has `valueCents 0`, `reason TIME_PRORATA`, and `subscriptionId`/`subscriptionType` set.
  - Assert `info.notReportableTimeAttendance` counts them.
  - Assert `info.pendingTimeSubscriptions` has `{ subscriptionId, endsAt: ISO, attendanceInPeriodCount }`.
- [x] **SET-08** [I] P0. TIME subscription ended (`endsAt <= generatedAt`; equality counts as ended, so freeze time to exactly `endsAt`):
  - Value = `splitCents(paidCents, count of ALL its PAID attendances)`, including those outside the period. Only in-period ones are allocated.
  - Example: 9000 over 4 attendances, 3 in period. Assert 2250 each and 6750 allocated.
- [x] **SET-09** [I] P0. ⚠ Suspect: pending TIME value is never paid automatically.
  - Steps: generate December while the TIME sub is pending (value 0), let it end, generate January.
  - Assert December's attendances are not re-allocated in January.
  - Assert only regenerating December pays them.
- [x] **SET-10** [I] P0. ⚠ Suspect: overlapping/duplicate settlements are allowed.
  - Assert generating the same period twice gives two DRAFT settlements, each with full allocations for the same attendances (the unique index is per settlement only).
  - Assert finalizing both takes the money out twice.
- [x] **SET-11** [I] P0. Lines:
  - Assert one line per trainer with `amountCents = Σ allocation.valueCents` and `attendanceCount` = all of that trainer's rows (incl. unpaid/pending).
  - Assert `unpaidAttendanceCount` and `details: { punchCents, timeCents }`.
  - Assert the response `lines` are ordered by `amountCents DESC`.
  - Assert a trainer with only unpaid attendance still gets a line with 0.
- [x] **SET-12** [I] P0. Assert all `info` counters for a mixed period: `totalAttendance`, `unpaidAttendance`, `reportablePunchPaidAttendance`, `reportableTimePaidAttendance`, `notReportableTimeAttendance`.
- [x] **SET-13** [I] P0. Attribution: assert `allocation.trainerId` is the attendance's trainer. Two trainers sharing one trainee's PUNCH sub each get their own attendance's split value.
- [x] **SET-14** [I] P1. Rounding invariant: assert that for a fully used PUNCH sub, or an ended TIME sub with all attendance in period, Σ allocations == `paidCents` exactly.

### Finalize
- [x] **SET-20** [I] P0. DRAFT → FINAL:
  - Assert exactly one cash-register tx: `SETTLEMENT_OUT`, `sourceType SETTLEMENT`, `sourceId = settlement.id`, `amountCents = −Σ lines.amountCents`.
  - Assert the balance dropped by that amount and `balanceAfterCents` matches.
- [x] **SET-21** [I] P0. Balance too low:
  - Assert 400 `Cash register balance cannot be negative`.
  - Assert the settlement stays DRAFT, there is no tx row, and the balance is unchanged (rollback).
- [x] **SET-22** [I] P0. Total 0 (only unpaid/pending rows): assert status FINAL and no cash tx.
- [x] **SET-23** [I] P0. Finalizing an already FINAL settlement: assert it returns the settlement, with no second tx and no balance change.
- [x] **SET-24** [I] P1. Unknown id → 404 `Settlement not found`.
- [x] **SET-25** [I] P1. ⚠ Suspect: finalize uses the line amounts **stored at generation**.
  - Steps: delete an attendance after generating (its allocation cascades away), then finalize.
  - Assert the cash-out equals the original line total, not Σ remaining allocations.

### Remove / read
- [x] **SET-30** [I] P1. Delete: assert `{ deleted: true }`, and that lines + allocations are gone (cascade). Unknown id → 404.
- [x] **SET-31** [I] P0. ⚠ Suspect: a FINAL settlement can be deleted.
  - Assert its `SETTLEMENT_OUT` tx stays and the balance is not restored.
  - Assert `GET /cash-register` then shows `sourceDetails: null` for it.
- [x] **SET-32** [I] P2. `list()` is ordered by `generatedAt DESC`.
- [x] **SET-33** [I] P1. `getById`:
  - Assert it returns `{ settlement, lines }`.
  - Assert the `trainerId` argument limits the lines to that trainer.
  - Assert unknown id → 404.
- [x] **SET-34** [I] P1. `allocations`:
  - Assert defaults `limit 50`, `offset 0`, ordering by attendance `trainedAt ASC, id ASC`, and that `total` counts all matches regardless of paging.
  - Assert the `trainerId` filter and that each row includes the `attendance` relation.
  - Assert an unknown settlement id → `{ total: 0, rows: [] }` (no 404).
- [x] **SET-35** [E] P2. Allocation query validation: `limit` 0 or 501 → 400, `offset` −1 → 400, non-UUID `trainerId` → 400, and numeric strings are coerced.

### Access (see also Appendix A)
- [x] **SET-40** [E] P0. TRAINER on `POST /settlements`, `DELETE /:id` and `POST /:id/finalize` → 403 with the handler-specific messages (`TRAINER cannot generate|delete|finalize settlement reports`).
- [x] **SET-41** [E] P0. TRAINER `GET /:id`: assert only their own lines. TRAINER token without `trainerProfileId` → 403 `Trainer profile is required for this action`.
- [x] **SET-42** [E] P0. TRAINER `GET /:id/allocations?trainerId=<other>`: assert the query value is overridden with their own id and only their rows come back.
- [x] **SET-43** [E] P1. TRAINER `GET /settlements` lists **all** settlement headers (not filtered). Characterize as-is.

---

## 2. Subscriptions: P0
- [x] **Module done** (service layer: `subscriptions.service.int-spec.ts`, incl. resolver; HTTP: `test/e2e/subscriptions.e2e-spec.ts`, SUB-06, SUB-40, SUB-41)
- [x] **Service layer done** (`subscriptions.service.int-spec.ts`, incl. resolver).

Code: `subscriptions/subscriptions.service.ts`, `subscription-resolver.service.ts`, `subscriptions.controller.ts`.

### Purchase
- [x] **SUB-01** [I] P0. PUNCH plan: assert `type PUNCH`, `initialCredits = remainingCredits = plan.credits`, `endsAt null`, `status ACTIVE`, and `paidCents` defaulting to `plan.priceCents`.
- [x] **SUB-02** [I] P0. TIME plan: assert `endsAt = startsAt + durationDays × 86 400 000 ms` (fixed 24h days, so across a DST change the *local* end time shifts by 1h) and credits null.
- [x] **SUB-03** [I] P1. `startsAt`:
  - Assert omitted → frozen "now".
  - Assert an ISO datetime with offset is respected.
  - ⚠ Suspect (minor): date-only `2025-12-10` → `2025-12-10T00:00:00.000Z` (UTC midnight, not Sofia midnight).
- [x] **SUB-04** [I] P0. Payment:
  - Assert a `paidCents` override is stored.
  - Assert `> 0` creates one `SUBSCRIPTION_IN` tx (`sourceId = subscription.id`) and raises the balance.
  - Assert `0` creates no tx and leaves the balance unchanged.
- [x] **SUB-05** [I] P0. Inactive/missing trainee → 400 `Trainee not found or inactive`. Inactive/missing plan → 400 `Plan not found or inactive`. Assert no subscription row, no cash tx, and no attendance changes.
- [x] **SUB-06** [E] P1. DTO: non-UUID `planId`, negative or non-integer `paidCents`, non-ISO `startsAt`, and unknown fields → 400.
- [x] **SUB-07** [I] P2. Plan with a broken shape (PUNCH with no credits, TIME with no duration; only via direct DB edit) → 400 `Punch plan must have credits` / `Time plan must have durationDays`.

### Reconciliation of unpaid attendance on purchase
- [x] **SUB-10** [I] P0. PUNCH, N credits, M < N unpaid: assert all M become PAID and linked, `remainingCredits = N−M`, status ACTIVE, and the **returned** entity shows the updated credits.
- [x] **SUB-11** [I] P0. PUNCH, M > N:
  - Assert the **oldest** N (`trainedAt ASC`, then `createdAt ASC`) become PAID and the newer ones stay UNPAID.
  - Assert `remainingCredits 0` and status `EXHAUSTED`.
- [x] **SUB-12** [I] P1. PUNCH, M == N → EXHAUSTED.
- [x] **SUB-13** [I] P0. ⚠ Suspect: TIME marks **all** the trainee's unpaid attendance PAID, including attendance before `startsAt` and after `endsAt`. The resolver would never match those (RES-02).
- [x] **SUB-14** [I] P0. Scope:
  - Assert other trainees' unpaid attendance is untouched.
  - Assert the trainee's already-PAID attendance (linked to another sub) is untouched.
- [x] **SUB-15** [I] P1. Reconciliation ignores `trainedAt` vs `startsAt` for PUNCH too. Unpaid attendance from before the purchase consumes credits.

### Delete
- [x] **SUB-20** [I] P0. Delete:
  - Assert its PAID attendance becomes UNPAID with `subscriptionId null`.
  - Assert UNPAID rows and other subs' rows are untouched.
  - Assert `{ deleted: true }`. Unknown id → 404 `Subscription not found`.
- [x] **SUB-21** [I] P0. ⚠ Suspect: deleting does not reverse the cash register. Assert the `SUBSCRIPTION_IN` tx and balance remain and `sourceDetails` becomes null.
- [x] **SUB-22** [I] P1. ⚠ Suspect: attendance freed by the delete is **not** re-reconciled against the trainee's other active subscriptions.
- [x] **SUB-23** [I] P1. Deleting a sub referenced by settlement allocations: assert the allocations remain with `subscriptionId null` (FK SET NULL) and unchanged `valueCents`.

### List
- [x] **SUB-30** [I] P2. `listForTrainee` returns all statuses ordered by `startsAt DESC, createdAt DESC`.

### Resolver: which subscription pays for an attendance
Test through `AttendanceService.create` (the real consumer) plus `resolveForAttendance` directly where that's clearer. Both are public.
- [x] **RES-01** [I] P0. PUNCH: eligible when ACTIVE with `remainingCredits > 0`, **regardless of `startsAt` vs `trainedAt`**. A PUNCH sub starting next month pays for today's attendance.
- [x] **RES-02** [I] P0. TIME: eligible when ACTIVE and `startsAt <= trainedAt < endsAt`. Assert start inclusive, end exclusive (attendance exactly at `endsAt` → not covered).
- [x] **RES-03** [I] P0. Status ≠ ACTIVE (EXHAUSTED, EXPIRED, CANCELLED via direct insert) is never eligible, even with credits or a matching window.
- [x] **RES-04** [I] P0. Several eligible: earliest `startsAt` wins, then earliest `createdAt`. PUNCH and TIME compete on the same ordering, e.g. an older PUNCH is used before a newer TIME that covers the date.
- [x] **RES-05** [I] P0. Another trainee's subscription is never used.

### Access
- [x] **SUB-40** [E] P0. ADMIN and TRAINER can create and delete subscriptions (incl. `paidCents: 0`). TRAINEE → 403.
- [x] **SUB-41** [E] P0. TRAINEE `GET /trainees/:ownId/subscriptions` → 200. Another trainee's id → 403 `TRAINEE can only access subscriptions for their own trainee profile`. TRAINEE token with `traineeProfileId: null` → 403.

---

## 3. Attendance write path: P0
- [x] **Module done** (service layer: `attendance.service.int-spec.ts`; HTTP: `test/e2e/attendance.e2e-spec.ts`, ATT-13, ATT-31, ATT-32)
- [x] **Service layer done** (`attendance.service.int-spec.ts`).

Code: `attendance/attendance.service.ts` (`create`, `createBatch`, `remove`), `attendance.controller.ts`.

### Create
- [x] **ATT-01** [I] P0. Eligible PUNCH:
  - Assert the attendance is PAID with `subscriptionId` set and the sub's `remainingCredits` dropped by 1.
  - Assert the response `info` is `{ paymentStatus: 'PAID', subscriptionId, subscriptionType: 'PUNCH', remainingCredits }`.
- [x] **ATT-02** [I] P0. Last credit: assert `remainingCredits 0` and status EXHAUSTED. Assert the next attendance is UNPAID, or uses the next eligible sub if there is one.
- [x] **ATT-03** [I] P0. Eligible TIME: assert PAID, no credit change, and that `info` has no `remainingCredits` key.
- [x] **ATT-04** [I] P0. No eligible sub: assert UNPAID, `subscriptionId null`, and `info.subscriptionId/subscriptionType` null.
- [x] **ATT-05** [I] P1. `gymSubscriptionId` is a **snapshot** of the trainee's value at creation. Assert changing the trainee later doesn't change old rows.
- [x] **ATT-06** [I] P0. Inactive/missing trainee / trainer / location → 400 `Trainee|Trainer|Location not found or inactive`, checked in that order. Assert nothing is persisted and credits are unchanged.
- [x] **ATT-07** [I] P1. The persisted `trainedAt` follows `resolveTrainedAt` (DT-02). One case per branch is enough here.
- [x] **ATT-08** [I] P1. ⚠ Suspect: future-dated attendance and exact duplicates (same trainee, same `trainedAt`) are accepted. Assert each duplicate consumes a credit.
- [x] **ATT-09** [I] P1. Concurrency invariant: two parallel `create` calls against a 1-credit PUNCH sub → exactly one PAID and one UNPAID, and `remainingCredits` never < 0. This exercises the lock + revert branch. Use real parallel transactions and repeat a few times. Mark flaky-prone. ⚠ **Found while writing it:** about half the time the loser fails with a Postgres deadlock (500) instead of being stored UNPAID. The invariants hold either way; see TEST_NOTES.

### Batch
- [x] **ATT-10** [I] P0. Duplicate `traineeIds` are de-duplicated. Assert `count` = unique trainees, `results` has one entry per trainee with its own payment resolution, and the response is `{ trainerId, trainedAt: ISO, count, results }`.
- [x] **ATT-11** [I] P0. Any missing/inactive trainee → 400 with body `message: 'Some trainees are missing or inactive'` and `invalidTraineeIds: [...]`. Assert **nothing** is created for any trainee.
- [x] **ATT-12** [I] P1. Validation order: trainer, then trainees, then location. Assert all three happen before any insert.
- [x] **ATT-13** [E] P1. DTO differences:
  - Assert `traineeIds` `[]` → 400, more than 200 → 400, and non-v4 UUIDs → 400 (`IsUUID('4')`).
  - Batch `trainedAt` is only `IsString`: garbage → 400 `Invalid trainedAt` (service message).
  - Single create uses `IsDateString`: garbage → 400 from the DTO, with a different message.

### Delete
- [x] **ATT-20** [I] P0. PAID + PUNCH: assert `remainingCredits + 1`, capped at `initialCredits`, and EXHAUSTED → ACTIVE.
- [x] **ATT-21** [I] P1. Status is set to ACTIVE whenever restored credits > 0, even from EXPIRED/CANCELLED (direct insert). Low impact today because nothing sets those statuses.
- [x] **ATT-22** [I] P0. Deleting TIME-linked or UNPAID attendance leaves subscriptions untouched.
- [x] **ATT-23** [I] P1. ⚠ Suspect: the restored credit isn't applied to the trainee's other UNPAID attendance.
- [x] **ATT-24** [I] P0. ⚠ Suspect: deleting attendance that's in a settlement cascades its allocation row, but the settlement **lines are not updated**, even for FINAL settlements. Lines and allocations then disagree.
- [x] **ATT-25** [I] P1. Unknown id → 404 `Attendance not found`.

### Lists + access
- [x] **ATT-30** [I] P1. `listForTraineeByPaymentStatus`:
  - Assert ordering `trainedAt DESC, createdAt DESC`.
  - Assert relations `trainer`, `location`, `subscription`, `gymSubscription` are loaded.
  - Assert `/paid` and `/unpaid` filter and the base route returns both.
- [x] **ATT-31** [E] P0. TRAINEE on `/attendance/trainees/:ownId` (and `/paid`, `/unpaid`) → 200. Another trainee's id → 403 `TRAINEE can only access trainings for their own trainee profile`.
- [x] **ATT-32** [E] P0. TRAINEE → 403 on create, batch, delete, dates, sessions and both reports.

---

## 4. Cash register: P0
- [x] **Module done** (service layer: `cash-register.service.int-spec.ts`; HTTP: `test/e2e/cash-register.e2e-spec.ts`, CR-10, CR-11)
- [x] **Service layer done** (`cash-register.service.int-spec.ts`).

Code: `cash-register/cash-register.service.ts`, controller. Balance lives in `cash_register_kv` (`cash_register_balance_cents`). Each change appends a transaction with `balanceAfterCents`.

- [x] **CR-01** [I] P0. Manual IN: assert `amountCents +X`, `MANUAL_IN`, `sourceType MANUAL`, `sourceId null`, `notes` stored (or null), and `balanceAfterCents`.
- [x] **CR-02** [I] P0. Manual OUT:
  - Assert the stored amount is **negative** and the type is `MANUAL_OUT`.
  - Overdraw → 400 `Cash register balance cannot be negative`. Assert no tx row and an unchanged balance.
- [x] **CR-03** [I] P0. OUT that brings the balance to exactly 0 is allowed.
- [x] **CR-04** [I] P1. Empty state: `getCurrentState()` → `{ balanceCents: 0, transactions: [] }`. Assert the first tx creates the kv row starting from 0.
- [x] **CR-05** [I] P0. Running balance: after a mixed sequence, assert each `balanceAfterCents` equals the cumulative sum, and `balanceCents` equals the last `balanceAfterCents` and Σ amounts.
- [x] **CR-06** [I] P0. Idempotency per `(sourceType, sourceId)`: assert calling `registerSubscriptionPayment` twice with the same id returns the existing tx, with no new row and no balance change.
- [x] **CR-07** [I] P0. Zero-amount automatic tx (`registerSubscriptionPayment` / `registerSettlementFinalization` with 0): assert it returns `null`, adds no row and leaves the balance unchanged. Replaces the current spy-based spec (INF-09).
- [x] **CR-08** [I] P1. `getCurrentState` ordering and enrichment:
  - Assert ordering by `createdAt DESC`.
  - Assert `SUBSCRIPTION_IN` → `sourceDetails { boughtBy { traineeId, name, nickname }, purchasedAt, subscriptionType, planTitle }`.
  - Assert `SETTLEMENT_OUT` → `{ periodStart, periodEnd }`.
  - Assert MANUAL or a deleted source → `null`.
- [x] **CR-09** [I] P2. Concurrency: parallel manual OUTs that together exceed the balance. Assert the final balance ≥ 0 and equals Σ committed tx amounts. Flaky-prone, optional.
- [x] **CR-10** [E] P0. ADMIN only: TRAINER/TRAINEE → 403 on both routes.
- [x] **CR-11** [E] P1. DTO: `direction` not `IN|OUT` → 400; `amountCents` 0, negative or non-integer → 400; `notes: ''` → 400.

---

## 5. Auth + access control: P0
- [x] **Module done** (service layer + AUTH-10 as below; HTTP: `test/e2e/auth.e2e-spec.ts` AUTH-01–09, `test/e2e/role-matrix.e2e-spec.ts` AUTH-11)
- [x] **Service layer done** (`auth/auth.service.int-spec.ts`: `validateUser`/`login` parts of AUTH-01–05 and AUTH-07; `auth/guards/roles.guard.spec.ts`: AUTH-10).

Code: `auth/*`, `accounts/dto/login.dto.ts`, every controller's `@Roles`.

- [x] **AUTH-01** [E] P0. Login success → `{ accessToken, account }`. Assert `account` has exactly these keys: `id, email, role, status, hasUpdatedInitialPassword, trainerProfileId, traineeProfileId, createdAt, updatedAt` (no `passwordHash`).
- [x] **AUTH-02** [E] P0. JWT claims (cross-repo contract with the frontend):
  - Assert exactly `sub, email, role, trainerProfileId, traineeProfileId, iat, exp`.
  - Assert profile ids are `null` when absent.
  - Assert `exp − iat` = `JWT_EXPIRES_IN` (7d default).
- [x] **AUTH-03** [E] P0. Wrong password and unknown email both → 401 `Invalid credentials` (same message).
- [x] **AUTH-04** [E] P0. DISABLED account → 401 `Account is not active (DISABLED)`. ⚠ Suspect: status is checked **before** the password, so a wrong password on a disabled account reveals that it exists and is disabled.
- [x] **AUTH-05** [E] P2. Account with `passwordHash null` (direct insert) → 401 `Account has no password set`.
- [x] **AUTH-06** [E] P1. Guards run before pipes:
  - Missing `email` or `password` → 401 (passport-local), not 400.
  - Valid credentials + an unknown body field → 400.
  - ⚠ Suspect: valid credentials with a password shorter than 3 characters → 400 (LoginDto `MinLength(3)` runs after auth succeeds).
- [x] **AUTH-07** [E] P2. Email lookup is exact and case-sensitive (`Admin` ≠ `admin`) and not trimmed.
- [x] **AUTH-08** [E] P0. `GET /auth/me` returns the JWT payload as-is (incl. `iat`, `exp`). No token, a bad signature, or an expired token (sign with a past `exp`) → 401.
- [x] **AUTH-09** [E] P0. ⚠ Suspect: a token stays valid after the account is DISABLED or deleted, or its role/profile changes. `JwtStrategy.validate` doesn't check the DB. Assert a disabled user's old token still gets 200 on a protected route.
- [x] **AUTH-10** [U] P0. `RolesGuard.canActivate` with a real `Reflector` and a fake `ExecutionContext`:
  - No metadata → true.
  - Handler roles override class roles (`getAllAndOverride`).
  - Role not listed → false.
  - No `req.user` → falsy.
- [x] **AUTH-11** [E] P0. **Role matrix.** One table-driven test over every route in Appendix A × {anonymous, ADMIN, TRAINER, TRAINEE}:
  - Anonymous → 401.
  - Disallowed role → 403 (`Forbidden resource` for guard denials, the handler message for in-handler denials).
  - Allowed role → anything but 401/403.
  - This is the single highest-value test against permission regressions. Keep it data-driven so adding a route forces adding a row.
  - Done: one row per route in `MATRIX`; a first test compares the rows with the routes Express actually registered, so a new route without a row fails. Allowed calls use a random UUID and minimal bodies, so they don't mutate data; rows whose handler check runs after the pipes (`POST /settlements`, `change-password`) send a valid body.

---

## 6. Accounts: P0
- [x] **Module done** (service layer: `accounts.service.int-spec.ts`; HTTP: `test/e2e/accounts.e2e-spec.ts`, ACC-05, ACC-13–17)
- [x] **Service layer done** (`accounts/accounts.service.int-spec.ts`).

Code: `accounts/accounts.service.ts`, `accounts.controller.ts`.

### Provision (`POST /accounts/:profileType/:profileId`)
- [x] **ACC-01** [I] P0. Trainer:
  - Assert an account with role TRAINER, `status` from the DTO, a password that verifies with `bcrypt.compare`, `hasUpdatedInitialPassword false`, and `trainerProfileId` set.
  - Assert **and** `trainer.accountId` = the new account id (both sides linked).
- [x] **ACC-02** [I] P0. Trainee: same as ACC-01 with `traineeProfileId`.
- [x] **ACC-03** [I] P0. Validation order:
  1. `password ≠ confirmPassword` → 400 `Passwords do not match`.
  2. `trainer` + role ≠ TRAINER → 400 `Trainer profile must be provisioned with TRAINER role`. Same for trainee.
  3. Unknown profileType + role ADMIN → 403 `This endpoint cannot create ADMIN accounts`. (So with `trainer` + ADMIN you get the 400 from step 2, never the 403.)
  4. Unknown profileType + TRAINER/TRAINEE → (email check, then) 400 `Invalid profile type`.
- [x] **ACC-04** [I] P0. Failures, each leaving no account row and the profile's `accountId` unchanged:
  - Email already used (by any account, incl. a DISABLED one) → 400 `Email is already used by another account`.
  - Profile missing or inactive → 404 `Trainer|Trainee profile not found or inactive`.
  - Profile already linked → 400 `Trainer|Trainee already has an account`.
  - ⚠ Suspect (found while writing it): a profile unlinked on the profile side only (`PATCH /trainers/:id { accountId: null }`, TRP-01) still has an account pointing at it, so provisioning hits the unique index and returns 400 `Cannot create account (email may already exist)`, which blames the email.
- [x] **ACC-05** [E] P1. Provisioned with `status: DISABLED` → login 401.

### Update / delete
- [x] **ACC-06** [I] P0. `update`:
  - Email change checks uniqueness; keeping your own email is OK.
  - `password` requires a matching `confirmPassword` (missing or different → 400 `Passwords do not match`) and sets `hasUpdatedInitialPassword = true`.
  - `status` change works.
  - Empty body → unchanged.
  - Unknown id → 404.
- [x] **ACC-07** [I] P0. `delete` is a soft disable:
  - Assert status DISABLED, both profile ids null, and the profile's `accountId` null.
  - Assert the account row and its email are kept, and the response is the sanitized, now-DISABLED account.
  - ⚠ Suspect: the email can never be reused for a new account (ACC-04).

### Passwords
- [x] **ACC-08** [I] P0. Self change (`requester.id === target`):
  - `newPassword ≠ confirmPassword` → 400, checked **first**.
  - Then `currentPassword` missing → 400 `Current password is required`; wrong → 400 `Current password is invalid`; null hash → 400 `Account has no password set`.
- [x] **ACC-09** [I] P0. First change (`hasUpdatedInitialPassword false`) requires a non-blank `phone`: missing, `''` or `'   '` → 400 `Phone is required when changing password for the first time`. Afterwards `phone` is optional.
- [x] **ACC-10** [I] P0. Effects:
  - Assert the response is `{ accountId, hasUpdatedInitialPassword: true }`.
  - Assert the new password logs in and the old one doesn't.
  - Assert the trainee profile `phone` is updated (trimmed) only when the account has a `traineeProfileId` and `phone` was sent; `phone: null` (after the first change) clears it; a trainer account's phone is ignored.
  - ⚠ Suspect (found while writing it): trainer and ADMIN accounts (incl. the seeded admin) must still send a phone on their first change, and it is thrown away.
  - ⚠ Suspect (minor, found while writing it): after the first change, `phone: '   '` is stored as `''`, not null.
- [x] **ACC-11** [I] P0. Change by someone else (admin/trainer reset):
  - Assert no `currentPassword` is needed.
  - ⚠ Suspect: `phone` is still required when the target hasn't changed their initial password.
  - ⚠ Suspect: it sets `hasUpdatedInitialPassword = true`, so the user is never prompted to replace an admin-chosen password.
- [x] **ACC-12** [I] P1. `hasUpdatedInitialPassword(id)` → `{ accountId, hasUpdatedInitialPassword }`. Unknown id → 404.

### HTTP
- [x] **ACC-13** [E] P1. `GET /accounts/:id` returns the sanitized account. ⚠ Suspect: an unknown id → **200 with an empty body** (`null`), where other modules return 404.
- [x] **ACC-14** [E] P0. TRAINEE may call `password-status` and `change-password` **only** for their own account id; others → 403 `TRAINEE can only access their own account password endpoints`. TRAINEE → 403 on PATCH, DELETE, GET and provision.
- [x] **ACC-15** [E] P0. ⚠ Suspect (security): TRAINER can PATCH (email/password/status) and DELETE **any** account, incl. ADMIN accounts. TRAINER can reset an ADMIN's password via `change-password` without the current password, then log in as ADMIN. TRAINER can provision accounts. Write the escalation as one scenario test and flag it prominently in TEST_NOTES.
- [x] **ACC-16** [E] P1. Route resolution: `POST /accounts/:id/change-password` is declared first, so it wins over `POST /accounts/:profileType/:profileId` for two-segment paths ending in `change-password`. The routes used in `tests.md` (`/accounts/provision/trainer/:id`, `PATCH /accounts/:id/status`) **don't exist** (404). `tests.md` is stale; don't use it as a spec.
- [x] **ACC-17** [E] P2. DTO rules that encode business rules: password `MinLength(8)` on provision/update/change, `IsEmail` on provision/update, enum checks on role/status.

---

## 7. Date/time utilities: P1 (do these first: no DB)
- [x] **Module done** (DT-01–06; DT-06 runs in its own `npm run test:tz-sofia` job, see DT-06). Specs next to each util: `attendance-timezone.util.spec.ts`, `attendance-time.util.spec.ts`, `attendance-range.util.spec.ts`, `attendance-datetime-range.util.spec.ts`, `settlements/settlement-allocation.util.spec.ts`.

Code: `attendance/attendance-timezone.util.ts`, `attendance-time.util.ts` (+ existing spec), `attendance-range.util.ts`, `attendance-datetime-range.util.ts`, `settlements/settlement-allocation.util.ts`. All [U]; run under `TZ=UTC`.

- [x] **DT-01** P0. `fromGymLocalToUtc`:
  - Winter (+02:00) and summer (+03:00); ms preserved; explicit `timeZone` argument.
  - DST spring-forward gap (2025-03-30 03:30 Sofia doesn't exist) and fall-back overlap (2025-10-26 03:30 happens twice): pin whatever instant it returns today.
  - ✅ Fixed (found by CI, fixed in #38): on Node 20 (production), `hour12: false` resolved to hour cycle `h24`, so every 00:xx gym-local time converted exactly one day early (also through `resolveTrainedAt`). The formatter now uses `hourCycle: 'h23'`. Regression tests cover 00:xx times in winter, in summer, on DST days and in other zones, and pass on Node 20, 22 and 24. Rows stored before the fix are not corrected (see TEST_NOTES § Fixed).
- [x] **DT-02** P0. `resolveTrainedAt` (extend the existing spec):
  - Explicit `Z`/`±hh:mm` kept as-is; `T08:10` without seconds → Sofia.
  - `trainedDate` only → 12:00 Sofia; `trainedDate + trainedTime` → Sofia.
  - `trainedTime` `24:00` or `12:60` → 400 `Invalid trainedTime`.
  - `trainedDate` with a zero part → 400 `Invalid trainedDate`; garbage `trainedAt` → 400 `Invalid trainedAt`.
  - Nothing given → frozen now. `trainedAt` wins over `trainedDate`. `trainedTime` without `trainedDate` is ignored (→ now).
  - ⚠ Suspect: date-only `trainedAt: '2025-01-15'` (passes `IsDateString`) → UTC midnight, not Sofia.
  - ⚠ Suspect: `trainedDate: '2025-02-30'` rolls over to 2025-03-02.
  - ⚠ Suspect (found while writing it): `trainedAt: '2025-01-15 08:10'` (space, no `T`) skips the Sofia branch and is parsed in **server-local** time; `trainedAt: '2025-01-15T25:00'` rolls over to the next day. Both pass the batch DTO (`IsString`).
  - Not a rule: `hasExplicitTimeZone` never changes the result (the zoneless regex is anchored, so strings with a zone never match it). Sabotaging it is an equivalent mutant.
- [x] **DT-03** P0. `getLocalDateInterval(from, to)`:
  - Returns `[from 00:00, to+1 00:00)` in process TZ; `from == to` OK; `from > to` → 400 `from must be <= to`; non-numeric → 400 `Invalid date`.
  - ⚠ Suspect: month 13 or day 32 roll over silently.
- [x] **DT-04** P0. `getLocalDateTimeInterval`:
  - Default times `00:00`/`23:59` → `to` = end day 23:59:59.999 + 1 ms = next day 00:00.
  - Custom times work; `24:00` → 400 `Invalid time`.
  - Start after end → 400 `start date/time must be before end date/time`; same minute → OK.
- [x] **DT-05** P0. `splitCents`: Σ parts == total; the extra cents go to the first parts (`10000/3 → [3334, 3333, 3333]`); `2/3 → [1, 1, 0]`; total 0 → zeros; `parts <= 0` → `[]`.
- [x] **DT-06** P2. Optional: run DT-03/DT-04 and the session grouping cases under `TZ=Europe/Sofia` in a second Jest project to document how behavior changes with server TZ (see Q1).
  - Done as a separate run, not a Jest project: a setup file can't switch the zone (Jest gives the sandbox a copy of `process.env`). `npm run test:tz-sofia` = `TZ=Europe/Sofia jest --config test/jest-tz-sofia.json`, files `*.sofia-spec.ts` / `*.sofia-int-spec.ts` (neither suffix matches the unit or int configs), guard `test/tz-sofia-guard.ts`. Needs the `TEST_DB_*` Postgres.
  - Covers DT-03 and DT-04 (winter, summer, DST gap/overlap, 23 h / 25 h days), ATR-01 dates, ATR-10 sessions (winter and summer), SET-02 periods and the cron run time (CRON-02). Under Sofia, SET-02, ATR-01 and ATR-10 line up with gym-local time. The cron still runs at 02:00 UTC (04:00/05:00 Sofia).
  - ⚠ **Not in CI yet.** Adding a `npm run test:tz-sofia` step to the `test` job in `docker-ghcr.yml` needs the owner's approval. Until then, run it by hand.

---

## 8. Attendance read path: P1
- [x] **Module done** (service layer: `attendance-read.service.int-spec.ts`; HTTP: `test/e2e/attendance-read.e2e-spec.ts`, ATR-03, ATR-22)
- [x] **Service layer done** (`attendance/attendance-read.service.int-spec.ts`).

### `GET /attendance/dates`
- [x] **ATR-01** [I] P1. ⚠ Suspect: rows are **grouped by Sofia date** (SQL `AT TIME ZONE`) but **filtered by a server-TZ range**. Under UTC:
  - 2026-01-01 01:30 Sofia (= 2025-12-31 23:30Z) appears in a `to=2025-12-31` query under date `2026-01-01`, a date outside the requested range.
  - 2025-12-01 01:00 Sofia is missing from a `from=2025-12-01` query.
- [x] **ATR-02** [I] P1.
  - Assert per day: `count`, `unpaidCount`, `paidCount = count − unpaidCount`, `hasUnpaid`.
  - Assert days are ordered ASC and empty days omitted.
  - Assert the `trainerId` and `traineeId` filters, and that `from/to` are echoed.
- [x] **ATR-03** [E] P2. Missing `from`/`to` or a bad UUID → 400.

### `GET /attendance/sessions`
- [x] **ATR-10** [I] P1. Grouping key:
  - Inside a training-time slot: `${day}|slot:${trainingTimeId}|${trainerId}|${locationId}`, using the slot's start/end.
  - Outside any slot: `${day}|custom:HH:mm|...` with `end = start + 60 min`.
  - Slot match is `[start, end)`.
  - ⚠ Suspect: `day`, hours and slot matching use **server-local** time (`getHours()`), while training times are entered as gym-local. Under UTC a 18:30 Sofia attendance does not fall into an 18:00–19:00 slot.
- [x] **ATR-11** [I] P1.
  - Assert a different trainer or location at the same time → separate sessions.
  - Assert overlapping training times → the first by `startTime ASC` wins.
  - Assert `totals { count, paid, unpaid }`.
  - Assert de-duplicated `entities { trainees, trainers, locations, gymSubscriptions }`.
  - Assert the echoed `filters` default to `'00:00'`, `'23:59'`, `trainerId: null`.
  - ⚠ Suspect (found while writing ATR-11): `startTime`/`endTime` bound **one continuous range** from `startDate startTime` to `endDate endTime`, not a time-of-day window applied to every day. `08:00`–`09:00` over two days includes 23:00 on the first day.
- [x] **ATR-12** [I] P1. Price info per attendance:
  - UNPAID → `{ priceCents: 0, calculation: 'UNPAID', subscriptionType: null, isFinal: true }`.
  - PUNCH → `splitCents(paidCents, initialCredits)[global index]`, `PUNCH_CREDIT`, `isFinal: true`.
  - TIME → `splitCents(paidCents, current number of PAID attendances)`, `TIME_PRORATA`, `isFinal = endsAt <= now`. The value changes as attendance is added until the sub ends.
  - PUNCH beyond credits (direct insert) → `{ 0, 'UNALLOCATED', 'PUNCH', false }`.
- [x] **ATR-13** [I] P1. Cross-check: for an ended TIME sub and a PUNCH sub, assert the session `priceCents` equals the settlement allocation `valueCents` for the same attendance. This guards the two copies of the allocation math against drift.

### Reports
- [x] **ATR-20** [I] P1. `reports/inactive-trainees?skipDays=N`:
  - Includes trainees with no attendance (`lastTrainingDate null`) or with last attendance **strictly before** `now − N×24h` (exactly at the threshold → excluded).
  - Sorted by last training DESC, never-trained last.
  - `activeSubscription` = the most recent (`startsAt DESC`) currently active sub, else null. Active = PUNCH ACTIVE with credits > 0, or TIME ACTIVE with `endsAt > now`.
  - Shape: `{ planName, type, startDate, endDate, remainingTrainings (PUNCH else null), remainingDays = max(0, ceil((endsAt − now)/day)) (TIME else null) }`.
  - Items have no trainee `id`; characterize the exact keys.
  - ⚠ Suspect: deactivated trainee profiles are included.
  - ⚠ Suspect: a TIME sub that **hasn't started** counts as active.
- [x] **ATR-21** [I] P1. `reports/without-active-subscription`:
  - Lists trainees with no currently active sub (same definition), same sort.
  - ⚠ Suspect: `lastActiveSubscription` is actually the latest sub by `startsAt` **regardless of status**.
  - ⚠ Suspect: deactivated trainees are included.
- [x] **ATR-22** [E] P2. `skipDays` missing, negative or non-integer → 400; `'3'` is coerced.

---

## 9. Plans: P1
- [x] **Module done** (service layer: `plans.service.int-spec.ts`; HTTP: `test/e2e/plans.e2e-spec.ts`, PLN-03, PLN-07, PLN-08. Also pinned: `?active=1`, `TRUE` and an empty value are treated as `false` too)
- [x] **Service layer done** (`plans/plans.service.int-spec.ts`).

- [x] **PLN-01** [I] P0. Create PUNCH: assert `credits` stored, `durationDays` forced to null even if sent, `title` trimmed, `isActive` default true.
- [x] **PLN-02** [I] P0. Create TIME: assert `durationDays` stored and `credits` forced to null.
- [x] **PLN-03** [E] P1. Create validation (service messages and the whitespace title are covered at [I]; DTO cases still open):
  - PUNCH with no credits → 400 `Punch plan requires credits` (service). `credits: 0` → 400 from the DTO (`Min(1)`, different message).
  - TIME with no duration → 400 `Time plan requires durationDays`.
  - Negative or float `priceCents` → 400.
  - ⚠ Suspect: `title: '   '` passes `IsNotEmpty` and is stored as `''`.
- [x] **PLN-04** [I] P0. Update:
  - Partial fields work.
  - Switching PUNCH→TIME needs `durationDays` (in the DTO or already stored), else 400; the switch clears `credits`. Same for TIME→PUNCH.
  - `credits: null` on a PUNCH plan → 400.
  - `credits` sent for a TIME plan is silently nulled.
- [x] **PLN-05** [I] P0. Assert changing price/credits/duration doesn't affect existing subscriptions (`paidCents`, credits and `endsAt` are fixed at purchase).
- [x] **PLN-06** [I] P0. DELETE = deactivate (`isActive false`, row kept). Assert an inactive plan can't be bought (SUB-05) and existing subs keep working.
- [x] **PLN-07** [I] P1. (Service filter + ordering done; the `?active=yes` suspect is controller parsing, left for [E].) List: `?active=true` → only active; `?active=false` → only inactive; no param → all; ordered `createdAt DESC`. ⚠ Suspect: any other value (`?active=yes`) is treated as `false`.
- [x] **PLN-08** [E] P1. (404 covered at [I]; roles still open.) Unknown id → 404 `Plan not found`. TRAINEE can list and get (incl. inactive plans) but gets 403 on create/update/delete.

---

## 10. Trainee profiles: P1
- [x] **Module done** (service layer: `trainee-profiles.service.int-spec.ts`; HTTP: `test/e2e/trainee-profiles.e2e-spec.ts`, TRN-01, 04, 06, 09, 10)
- [x] **Service layer done** (`trainee-profiles/trainee-profiles.service.int-spec.ts`).

- [x] **TRN-01** [E] P0. (Service side covered at [I]: any non-blank search rejects with a non-HTTP error; HTTP status still open.) ⚠ Suspect (bug): `GET /trainees?search=<non-blank>` → **500**. The `where` uses `firstName`/`lastName`, which don't exist on the entity (TypeORM 0.3 throws `EntityPropertyNotFoundError`), so search by name, nickname or phone doesn't work at all. Assert only the status code. Whitespace-only search is ignored and returns the normal list.
- [x] **TRN-02** [I] P1. List: `active` filter (same `'true'` parsing as plans); ordered `name ASC, nickname ASC`.
- [x] **TRN-03** [I] P0. Create:
  - `name`, `nickname` and `phone` are trimmed.
  - `accountId` already used by another trainee → 400 `This account is already linked to another trainee`.
  - Inactive/missing `gymSubscriptionId` → 400 `Gym subscription not found or inactive`.
  - ⚠ Suspect: `accountId` isn't checked to exist or to be a TRAINEE account (a TRAINER account id is accepted), and it isn't linked back on the account, so that account's JWT has `traineeProfileId: null`. Assert the account row stays unlinked. An unknown `accountId` is caught only by the DB foreign key (non-HTTP error → 500).
- [x] **TRN-04** [E] P0. ⚠ Suspect: PATCH **requires `name`** (`UpdateTraineeDto.name` has no `@IsOptional`). Assert `PATCH { isActive: false }` → 400.
- [x] **TRN-05** [I] P1. Update:
  - `nickname`/`phone: null` clear the field.
  - `gymSubscriptionId: null` clears it; otherwise it must be active.
  - `accountId: null` unlinks (profile side only).
  - An `accountId` conflict → 400; re-sending your own `accountId` is OK.
- [x] **TRN-06** [I] P1. (Done at [I], incl. login still working; "read its own data" needs [E].) DELETE = deactivate. Assert an inactive trainee can't get new attendance or subscriptions (400). ⚠ Suspect: the linked account can still log in and read its own data.
- [x] **TRN-07** [I] P1. `overview`:
  - Returns `trainee`.
  - `subscriptions.active`: ACTIVE PUNCH with credits, or ACTIVE TIME with `endsAt > now`, ordered `startsAt ASC`.
  - `subscriptions.recent`: at most 10, `startsAt DESC`.
  - `attendance.recent`: at most 20, with `trainer { id, name, nickname }` and `subscription { id, type } | null`.
  - Unknown id → 404.
- [x] **TRN-08** [I] P2. `trainingInsights`:
  - `totalAttendances`.
  - Partners = other trainees with the same trainer + location + **exact** `trainedAt`, ordered count DESC then name ASC.
  - `topTrainers` and `topGyms` with the same ordering.
  - `topWeekdays` (ISO weekday number, English day name, Sofia TZ) and `topTimeSlots` (`HH:00-HH:59`, Sofia).
  - Unknown id → 404.
  - Day names depend on the DB's `lc_time`; assert `weekdayNumber` strictly and the name loosely.
- [x] **TRN-09** [E] P0. `/trainees/me/training-insights` is TRAINEE **only**: ADMIN/TRAINER → 403 because handler roles override class roles. TRAINEE without `traineeProfileId` → 403 `Trainee profile is not linked to account`.
- [x] **TRN-10** [E] P0. TRAINEE → 403 on every other `/trainees` route. TRAINER has full CRUD.

---

## 11. Subscriptions cron: P1
- [x] **Module done** (CRON-01 in `subscriptions.service.int-spec.ts`; CRON-02 and CRON-03 in `subscriptions-cron.service.int-spec.ts`, plus a Sofia-TZ variant under DT-06)

- [x] **CRON-01** [I] P0. `exhaustPastEndTimeSubscriptions()`:
  - TIME + ACTIVE + `endsAt < now` → **EXHAUSTED**.
  - `endsAt == now` → untouched. PUNCH and non-ACTIVE → untouched.
  - Returns the affected count.
  - ⚠ Suspect: the status is EXHAUSTED, not EXPIRED. `EXPIRED` and `CANCELLED` are never set anywhere in the codebase.
- [x] **CRON-02** [I] P2. Scheduling, with all timers faked (exception to INF-04; DB calls happen after advancing time):
  - Next run at 02:00 **UTC** today if now is before it, else tomorrow; exactly 02:00:00.000 → tomorrow.
  - After advancing to the run time, assert an expired TIME sub becomes EXHAUSTED and the next run is scheduled.
  - After `onModuleDestroy`, assert nothing fires.
  - Done: `freezeTimeAndTimeouts` (`test/int/clock.ts`) fakes only `Date` + `setTimeout`/`clearTimeout`, so `pg` keeps working. `test/int/cron-harness.ts` drives the lifecycle hooks and waits for each run. Also pinned: the month/year rollover (Dec 31 → Jan 1), a third consecutive run, and destroy after a run. Every assertion checks whether an expired TIME sub is EXHAUSTED yet.
  - ✅ Fixed (found while writing it): a run whose DB update threw was an unhandled rejection. On Node 20 and 24 (default `--unhandled-rejections=throw`) that crashed the process, and the next run was never scheduled. See CRON-03 and TEST_NOTES § Fixed.
- [x] **CRON-03** [I] P1. A failed run (the job's UPDATE throws) is logged, doesn't reject, and the next run is still scheduled for 02:00 UTC the following day; also when the failure follows a successful run. In `subscriptions-cron.service.int-spec.ts`; the failure is a real DB error (`withSubscriptionsTableOffline` in `test/int/cron-harness.ts` renames the `subscriptions` table during the run), and `runOutcomes()` checks that the failed run really happened.

---

## 12. Trainer profiles: P2
- [x] **Module done** (service layer: `trainer-profiles.service.int-spec.ts`; HTTP: `test/e2e/trainer-profiles.e2e-spec.ts`, TRP-02, TRP-04)
- [x] **Service layer done** (`trainer-profiles/trainer-profiles.service.int-spec.ts`).

- [x] **TRP-01** [I] P1. Create/update:
  - `name`/`nickname` trimmed; `nickname: null` clears it.
  - `accountId` uniqueness → 400 `This account is already linked to another trainer`; `accountId: null` unlinks.
  - ⚠ Suspect: there's no reverse link on the account (same as TRN-03). Also pinned: any account id is accepted (even a TRAINEE account), an unknown id fails on the FK (500), and unlinking leaves the account (and its JWT claim) pointing at the trainer (see ACC-04).
- [x] **TRP-02** [E] P1. ⚠ Suspect: PATCH requires `name` (same as TRN-04).
- [x] **TRP-03** [I] P1. DELETE = deactivate. Assert attendance with an inactive trainer → 400 and provisioning for an inactive trainer → 404. ⚠ The trainer's account can still log in (TRAINER role + `trainerProfileId` claim).
- [x] **TRP-04** [E] P0. There is no class-level `@Roles`, so **any authenticated user, incl. TRAINEE**, can list and get trainers. POST/PATCH/DELETE are ADMIN only (TRAINER → 403).
- [x] **TRP-05** [I] P2. List `active` filter; ordered `name ASC`; unknown id → 404 `Trainer not found`.

---

## 13. Training times: P2
- [x] **Module done** (service layer: `training-times.service.int-spec.ts`; HTTP: `test/e2e/training-times.e2e-spec.ts`, TT-01)
- [x] **Service layer done** (`training-times/training-times.service.int-spec.ts`).

- [x] **TT-01** [E] P1. Create: `HH:mm` 24h regex; `end <= start` (incl. equal) → 400 `endTime must be after startTime`.
- [x] **TT-02** [I] P1. Partial update is validated against the stored value. Postgres `time` returns `'HH:mm:ss'`; assert updating only `endTime` to before the stored start → 400.
- [x] **TT-03** [I] P2. List ordered `startTime ASC`. Unknown id → 404 `Training time not found`. DELETE is a **hard** delete → `{ deleted: true }`. Overlapping slots are allowed.
- [x] **TT-04** [I] P2. Response format: POST/PATCH return the input string (`'09:00'`), GET returns `'09:00:00'`. Frontend contract; verify first, then pin. Verified: ⚠ PATCH returns the **sent** field as `HH:mm` and the untouched one as `HH:mm:ss` in the same body.

---

## 14. Gym locations and gym subscriptions: P2
- [x] **Module done** (service layer: both `*.service.int-spec.ts`; HTTP: `test/e2e/gym-locations.e2e-spec.ts`, GL-02, GL-03, each case run against both resources)
- [x] **Service layer done** (`gym-locations/gym-locations.service.int-spec.ts`, `gym-subscriptions/gym-subscriptions.service.int-spec.ts`).

- [x] **GL-01** [I] P2. Create: `isActive true`; `address`/`notes` default null. Location `name` is **not** trimmed; gym-subscription `name` is.
- [x] **GL-02** [E] P1. List hides inactive unless `includeInactive=true`; `false` → active only; a non-boolean string or unknown query param → 400 (these use query DTOs, unlike plans/trainees/trainers). ⚠ Found at the service layer: `includeInactive=1` passes `IsBooleanString` but is treated as false.
- [x] **GL-03** [E] P1. ⚠ Suspect: there's no way to reactivate. `isActive` isn't in the update DTOs, so `PATCH { isActive: true }` → 400.
- [x] **GL-04** [I] P1. DELETE = deactivate. Assert attendance at an inactive location → 400 (ATT-06) and historical attendance is unchanged.
- [x] **GS-01** [I] P1. Deactivated gym subscription: it can't be newly assigned to a trainee (400, TRN-03/05). Trainees who already have it keep it, and new attendance still snapshots it (ATT-05). ⚠ Re-sending the trainee's own, now inactive, gym subscription in a PATCH → 400 and the whole edit is rejected.
- [x] **GS-02** [I] P2. CRUD + 404 messages (`Location not found`, `Gym subscription not found`).

---

## 15. Bootstrap and app: P2
- [x] **Module done** (BOOT-01/02 in `bootstrap/bootstrap.service.int-spec.ts`, APP-01 in `test/app.e2e-spec.ts`)

- [x] **BOOT-01** [I] P1. With `SEED_ADMIN_EMAIL/PASSWORD` set and no such email: assert one ADMIN, ACTIVE account whose password verifies.
- [x] **BOOT-02** [I] P1. Email already exists (any role/status): assert no change (password **not** reset, role not changed). Missing either env var → nothing created. Also pinned: empty env values skip the seed, and the email match is exact (a different-case account doesn't stop it).
- [x] **APP-01** [E] P2. `GET /api` → `'Hello TheIndex!'`; `GET /api/health` → `{ ok: true }`; both work without auth.

---

## 16. Cross-cutting: P1
- [x] **Module done** (`test/e2e/cross-cutting.e2e-spec.ts`). Caveat: X-01 and X-02 exercise the `main.ts` setup that `test/e2e/e2e-app.ts` duplicates (Q4), so they would not notice a change to `main.ts` itself.

- [x] **X-01** [E] P1. Routes exist only under `/api`, e.g. `GET /plans` → 404.
- [x] **X-02** [E] P1. Unknown body fields → 400 with `message` as an array. Nest exception body is `{ statusCode, message, error }`; the frontend reads `message`.
- [x] **X-03** [E] P1. ⚠ Suspect: path ids aren't validated (no `ParseUUIDPipe`), so a non-UUID id, e.g. `GET /api/plans/abc`, reaches Postgres and returns **500**. Assert the status only, on 2–3 representative routes.
- [x] **X-04** [E] P0. **Money scenario.** One end-to-end story:
  - Manual IN; buy PUNCH and TIME subs (one with unpaid attendance to reconcile); record attendance by two trainers; let the TIME sub end; generate + finalize the settlement.
  - Assert the cash balance = manual + Σ `paidCents` − Σ finalized line amounts, and each trainer's line equals the hand-computed value.
  - This catches integration breaks the unit-level cases miss.
- [x] **X-05** [E] P2. Plans/trainees/trainers parse `?active` by hand (no DTO), so unknown query params there are **ignored** (not 400), unlike gym-locations/gym-subscriptions.

---

## Out of scope

- `hardDelete()` in plans, trainees, trainers and gym-locations: no route calls them.
- `getLocalDayRange()` in `attendance-date.util.ts`: unused.
- `main.ts` `parseOrigins` (CORS) and Swagger setup: not exported, so testing them would need a production refactor. Revisit with Q4.
- Entity/schema shape and `synchronize`: covered indirectly; no migrations exist to test.
- Exhaustive DTO validation (every `IsString`/`Length`). Test only DTO rules that encode business rules (listed above). Framework behavior doesn't need re-testing.
- Snapshot tests of whole responses: they fail on any change, not when a rule breaks. Assert explicit keys/values instead.
- Log output.

## Open questions for the owner

- **Q1. Production timezone.** The Docker image (`node:24-alpine`) runs in UTC unless the compose file (not in either repo) sets `TZ`. Settlement periods, `/attendance/dates` and `/attendance/sessions` grouping depend on it. The cron does **not**: it uses UTC setters and runs at 02:00 UTC in any zone (DT-06). This plan pins `TZ=UTC`. If production sets `TZ=Europe/Sofia`, switch INF-03 before writing date-sensitive tests, and several ⚠ items (SET-02, ATR-01, ATR-10) stop being suspects. DT-06 (`npm run test:tz-sofia`) already pins what they do under Sofia.
- **Q2. Test DB.** The plan uses real Postgres. The code relies on `AT TIME ZONE`, `to_char`, `EXTRACT(ISODOW)`, `FOR UPDATE` locks and enum columns, which mocked repositories or `pg-mem` can't faithfully run. Mocked repos would also mean asserting on query-builder chains, which breaks the "fail if the rule breaks" rule. OK to require Docker locally and a Postgres service in CI?
- **Q3. CI gate (INF-10).** ✅ Approved and done (Nov 2026), including the lint gate (baseline errors fixed with type/format-only changes; no behavior change).
- **Q4. e2e setup duplication.** INF-06 copies the `main.ts` app setup into the tests. The alternative is a tiny refactor that exports a `configureApp(app)` from `main.ts` and uses it in both places. That's a production change, so it isn't done without approval.
- **Q5. Business rules flagged ⚠ that affect money or security:** ACC-15 (TRAINER can take over ADMIN), SET-09/SET-10/SET-31 (lost, double or unreversed payouts), SUB-13 (TIME pays for out-of-window attendance), SUB-21 (deleting a sub keeps the cash). These get characterized as-is, but they deserve an owner decision soon.

## Self-review log

Review of the first draft of this plan. Changes are already applied above.

**Missed in the first draft, now added**
- Role matrix as data (AUTH-11 + Appendix A): per-module access cases alone would let a newly added route slip through unguarded.
- Guard-before-pipe ordering on login (AUTH-06) and disabled-account enumeration (AUTH-04).
- TRAINER → ADMIN takeover path (ACC-15). The first draft only had "TRAINER can manage accounts".
- Cross-check between session price info and settlement allocations (ATR-13): the same math exists twice, so drift is likely.
- Attendance delete leaving settlement lines stale (ATT-24, SET-25), and FINAL settlements being deletable (SET-31).
- End-to-end money invariant (X-04).
- Determinism traps: `createdAt` comes from the DB clock and is shared within a transaction (INF-04/05). Faking all timers breaks `pg`, so fake only `Date` (INF-04). `JwtStrategy` reads the secret at construction (INF-06).
- `tests.md` uses routes that don't exist (ACC-16), so it must not be treated as a spec.
- Existing `cash-register.service.spec.ts` breaks the new rules (INF-09). Stale `Hello World!` tests would block any CI gate (INF-08).
- Query-param handling differs between modules (X-05, GL-02).

**Judged low-value, demoted or cut**
- "Reconciliation reads unpaid rows outside the transaction": not observable in a deterministic test. Cut; mentioned here only.
- Mid-batch rollback for attendance batch: unreachable because everything is pre-validated. Cut.
- PUNCH attendance beyond initial credits (SET/ATR): only reachable by corrupting data. Folded into ATR-12 as one P2 line.
- Invalid plan shapes at purchase (SUB-07), `passwordHash null` login (AUTH-05), concurrency tests (ATT-09 P1, CR-09 P2): kept but demoted.
- Cron scheduling details (CRON-02): demoted to P2. The status change (CRON-01) is what matters.
- `JWT_SECRET` missing at boot, Swagger docs endpoint, CORS parsing, `hardDelete`, `getLocalDayRange`: cut (see Out of scope).
- Exhaustive per-field DTO tests and response snapshots: cut in favor of business-rule DTO checks and explicit key assertions.

**Ambiguous, so asserted narrowly or turned into owner questions**
- Server TZ (Q1): it decides whether SET-02/ATR-01/ATR-10 are bugs. Tests pin UTC and DT-06 documents the Sofia variant.
- Behaviors that return 500 (TRN-01, X-03): assert the status code only, not the generic message, so the test doesn't depend on framework wording.
- Postgres day names (TRN-08) depend on DB locale: assert the weekday number strictly and the name loosely.
- Training-time string format (TT-04): TypeORM's save-vs-read difference is inferred, not observed. Verify before pinning.
- DST gap/overlap results (DT-01): there's no "right" answer in the code. Pin today's output.
- Whether money/security ⚠ items are intended (Q5): characterize now, decide later. Every ⚠ test needs a TEST_NOTES entry.

**Second pass, on the written plan**
- Fixed: the time-freezing advice in `CLAUDE.md` contradicted INF-04 (it faked `setTimeout`). Both now say "fake only `Date`".
- Added: trainee `accountId` can point at a TRAINER account (TRN-03).
- Checked every Appendix A row against the controllers' `@Roles` (class vs handler override, `getAllAndOverride`) and the in-handler checks.
- Re-derived every worked example: SET-05/06/08, DT-05, the ATR-01 timestamps, the ACC-03 ordering.
- Still open: no case covers re-enabling a soft-deleted account via `PATCH { status: 'ACTIVE' }` (it comes back with no profile links). Left out as low-value; add it if account lifecycle work starts.

---

## Appendix A: Route × role matrix (for AUTH-11)

Legend: ✅ allowed by guard · 🔒 guard denies (403 `Forbidden resource`) · ✋ guard allows but the handler denies (403, handler message) · 👤 TRAINEE allowed only for their own id (else ✋) · `—` public. Anonymous gets 401 on every non-public route.

| Method | Route (under `/api`) | ADMIN | TRAINER | TRAINEE |
|---|---|---|---|---|
| GET | `/` , `/health` | — | — | — |
| POST | `/auth/login` | — | — | — |
| GET | `/auth/me` | ✅ | ✅ | ✅ |
| PATCH | `/accounts/:id` | ✅ | ✅ ⚠ | 🔒 |
| DELETE | `/accounts/:id` | ✅ | ✅ ⚠ | 🔒 |
| GET | `/accounts/:id` | ✅ | ✅ | 🔒 |
| GET | `/accounts/:id/password-status` | ✅ | ✅ | 👤 (account id = `sub`) |
| POST | `/accounts/:id/change-password` | ✅ | ✅ ⚠ | 👤 (account id = `sub`) |
| POST | `/accounts/:profileType/:profileId` | ✅ | ✅ ⚠ | 🔒 |
| GET | `/plans`, `/plans/:id` | ✅ | ✅ | ✅ |
| POST / PATCH / DELETE | `/plans`, `/plans/:id` | ✅ | ✅ | 🔒 |
| GET | `/trainers`, `/trainers/:id` | ✅ | ✅ | ✅ (no class roles) |
| POST / PATCH / DELETE | `/trainers`, `/trainers/:id` | ✅ | 🔒 | 🔒 |
| GET / POST | `/trainees` | ✅ | ✅ | 🔒 |
| GET / PATCH / DELETE | `/trainees/:id` | ✅ | ✅ | 🔒 |
| GET | `/trainees/:id/overview` | ✅ | ✅ | 🔒 |
| GET | `/trainees/me/training-insights` | 🔒 | 🔒 | ✅ (needs `traineeProfileId`, else ✋) |
| POST | `/trainees/:traineeId/subscriptions` | ✅ | ✅ | 🔒 |
| GET | `/trainees/:traineeId/subscriptions` | ✅ | ✅ | 👤 |
| DELETE | `/subscriptions/:id` | ✅ | ✅ | 🔒 |
| POST | `/attendance`, `/attendance/batch` | ✅ | ✅ | 🔒 |
| GET | `/attendance/dates`, `/attendance/sessions` | ✅ | ✅ | 🔒 |
| GET | `/attendance/reports/inactive-trainees`, `/attendance/reports/without-active-subscription` | ✅ | ✅ | 🔒 |
| GET | `/attendance/trainees/:traineeId` (+ `/paid`, `/unpaid`) | ✅ | ✅ | 👤 |
| DELETE | `/attendance/:id` | ✅ | ✅ | 🔒 |
| GET | `/cash-register` | ✅ | 🔒 | 🔒 |
| POST | `/cash-register/transactions/manual` | ✅ | 🔒 | 🔒 |
| POST | `/settlements` | ✅ | ✋ | 🔒 |
| GET | `/settlements` | ✅ | ✅ (all headers) | 🔒 |
| GET | `/settlements/:id` | ✅ | ✅ own lines (needs `trainerProfileId`, else ✋) | 🔒 |
| DELETE | `/settlements/:id` | ✅ | ✋ | 🔒 |
| POST | `/settlements/:id/finalize` | ✅ | ✋ | 🔒 |
| GET | `/settlements/:id/allocations` | ✅ | ✅ own rows (needs `trainerProfileId`, else ✋) | 🔒 |
| GET / POST | `/gym-locations` | ✅ | ✅ | 🔒 |
| GET / PATCH / DELETE | `/gym-locations/:id` | ✅ | ✅ | 🔒 |
| GET / POST | `/gym-subscriptions` | ✅ | ✅ | 🔒 |
| GET / PATCH / DELETE | `/gym-subscriptions/:id` | ✅ | ✅ | 🔒 |
| GET / POST | `/training-times` | ✅ | ✅ | 🔒 |
| GET / PATCH / DELETE | `/training-times/:id` | ✅ | ✅ | 🔒 |
| GET / POST | `/media` | ✅ | 🔒 | 🔒 |
| GET / PATCH | `/media/:id` | ✅ | 🔒 | 🔒 |
| GET / POST | `/article-categories` | ✅ | 🔒 | 🔒 |
| GET / PATCH / DELETE | `/article-categories/:id` | ✅ | 🔒 | 🔒 |
