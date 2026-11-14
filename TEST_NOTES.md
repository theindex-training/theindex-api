# Test notes: behavior that looks unintended

Each entry is pinned by a characterization test marked `// CHARACTERIZATION: possibly unintended`. The tests assert **current** behavior. Fixing one of these means first changing the test to the desired behavior (it will fail), then fixing the code, and updating the entry here in the same PR. Format: see `CLAUDE.md` § Testing rules.

Ordered by impact (money and data integrity first).

## accounts: a TRAINER can take over the ADMIN account (security)
- Test: `test/e2e/accounts.e2e-spec.ts` > `ACC-15 TRAINER resets the ADMIN password without the current one and logs in as ADMIN`; `ACC-15 TRAINER can PATCH (email/password/status) and DELETE an ADMIN account, and provision accounts`; also pinned row by row in `test/e2e/role-matrix.e2e-spec.ts` (AUTH-11)
- Current behavior: `AccountsController` allows `ADMIN` and `TRAINER` on every route and never looks at the target account's role. A TRAINER can `POST /api/accounts/<adminId>/change-password` with only `newPassword`/`confirmPassword` (+ a `phone`, because the seeded admin hasn't changed the initial password); no current password is needed because it isn't a self change. The TRAINER can then log in as ADMIN with the new password, and the real admin is locked out. The same TRAINER can `PATCH` the admin's email, password and status, `DELETE` (disable) the admin, re-enable it, and provision new TRAINER/TRAINEE accounts.
- Why it looks unintended: every money route that matters (cash register, settlement generate/finalize/delete, trainer CRUD) is ADMIN-only, so TRAINER is clearly meant to be the less trusted role. This path turns any trainer account into a full admin.
- Impact / who would notice: the owner. A trainer (or anyone with a trainer's password) can take over the admin account, move cash, delete settlements and lock the owner out. Combined with the next entry, revoking access afterwards doesn't end an open session. Open question Q5.

## auth: a JWT stays valid after its account is disabled or deleted
- Test: `test/e2e/auth.e2e-spec.ts` > `AUTH-09 a token stays valid after its account is DISABLED or deleted (no DB check)`
- Current behavior: `JwtStrategy.validate` returns the token payload without reading the database. After `DELETE /api/accounts/:id` (status DISABLED, profile links cleared) the old token still reads that trainee's subscriptions and training insights, and after the account row is deleted outright `GET /api/auth/me` still returns 200 with the old claims. Role and profile changes are likewise invisible until the token expires (7 days).
- Why it looks unintended: disabling an account is the only "revoke access" tool the API has, and it doesn't revoke anything for up to 7 days.
- Impact / who would notice: the owner, when removing a trainer or a former member; they keep working access (incl. TRAINER write access) until their token expires. Same root cause as the TRN-06/TRP-03 entries below, but those are about logging in again.

## attendance: concurrent creates on the same PUNCH subscription can deadlock (500)
- Test: `src/attendance/attendance.service.int-spec.ts` > `ATT-09 parallel creates on a 1-credit sub: exactly one PAID, credits never < 0, the loser is UNPAID or fails with a deadlock`
- Current behavior: when two `create` calls for the same trainee run at the same time against a PUNCH sub, about half the time Postgres aborts one of them with `deadlock detected` (`QueryFailedError`, so HTTP 500). Each transaction first inserts the attendance row, whose FK on `subscriptionId` takes a `FOR KEY SHARE` lock on the subscription row. Both then run `SELECT … FOR UPDATE` on that row, and `FOR UPDATE` conflicts with the other transaction's `KEY SHARE`. The rest of the time the second transaction waits, sees 0 credits and takes the "revert to UNPAID" branch, as the code intends. Either way the money invariants hold: exactly one PAID row, credits never below 0, and the aborted request leaves nothing behind.
- Why it looks unintended: the code has an explicit race branch ("Edge case (race): revert this attendance to UNPAID"), so the author expected the loser to be stored as UNPAID, not to fail. Not listed in `TEST_PLAN.md`; found while writing ATT-09. The same pattern (insert with FK, then lock the parent) probably applies to batch creates for trainees who share nothing, but that isn't tested.
- Impact / who would notice: staff recording attendance from two devices at once (or a double-click / retry) for the same trainee get an error toast for one of them; the attendance is silently missing until re-entered. Low frequency, and no money is lost.

## settlements: the same period can be generated and finalized more than once
- Test: `src/settlements/settlements.service.int-spec.ts` > `SET-10 the same period can be generated twice and both can be finalized (money out twice)`
- Current behavior: `generate` always creates a new DRAFT settlement with full allocations for every attendance in the period. Nothing checks for an existing settlement for the same or an overlapping period (the unique index is per settlement). Finalizing both takes the payout out of the cash register twice.
- Why it looks unintended: a payout for the same trainer work should happen once. Nothing in the UI flow needs duplicate settlements.
- Impact / who would notice: the owner. A second "generate + finalize" for a month that was already paid doubles the trainer payout and drains the register.

## settlements: TIME subscriptions that are still running are never paid by a later settlement
- Test: `src/settlements/settlements.service.int-spec.ts` > `SET-09 pending TIME value is never paid by a later period; only regenerating the old period pays`
- Current behavior: when a TIME sub hasn't ended at `generatedAt`, its in-period attendance is allocated 0 and listed in `info.pendingTimeSubscriptions`. Later settlements only look at their own period, so after the sub ends that value is never picked up. The only way to pay it is to generate the old period again, which creates a second settlement for it (see the previous entry).
- Why it looks unintended: the `pendingTimeSubscriptions` info implies the value is deferred, not dropped. In practice it's dropped unless someone remembers to regenerate.
- Impact / who would notice: trainers. Any month that is settled before the trainee's TIME pass ends underpays them for that pass.

## settlements: finalize pays the line totals stored at generation time
- Test: `src/settlements/settlements.service.int-spec.ts` > `SET-25 finalize pays the line amounts stored at generation, not the remaining allocations`
- Current behavior: deleting an attendance after generation cascades its allocation row away, but `settlement_lines.amountCents` is not recalculated. `finalize` sums the stale lines, so it pays out for attendance that no longer exists.
- Why it looks unintended: the allocations (the per-attendance detail) and the lines (the total paid) disagree, and the money follows the stale side.
- Impact / who would notice: the owner. Correcting a wrong attendance entry between "generate" and "finalize" still pays for it.

## attendance: deleting settled attendance leaves settlement lines stale (even FINAL ones)
- Test: `src/attendance/attendance.service.int-spec.ts` > `ATT-24 deleting settled attendance drops its allocation but not the (FINAL) settlement line`
- Current behavior: attendance delete cascades the `settlement_allocations` row (FK `ON DELETE CASCADE`) but leaves `settlement_lines` unchanged, including in FINAL settlements whose money has already gone out.
- Why it looks unintended: a FINAL settlement is a financial record; its detail rows silently disappear and stop adding up to the line totals.
- Impact / who would notice: anyone auditing a past payout. `GET /settlements/:id/allocations` no longer explains `amountCents`.

## settlements: a FINAL settlement can be deleted and the cash-out stays
- Test: `src/settlements/settlements.service.int-spec.ts` > `SET-31 a FINAL settlement can be deleted; its cash-out stays and loses sourceDetails`
- Current behavior: `remove` deletes any settlement regardless of status. For a FINAL one the `SETTLEMENT_OUT` transaction and the reduced balance remain; the cash register shows the tx with `sourceDetails: null`.
- Why it looks unintended: it destroys the only record explaining a cash movement, and nothing reverses the money.
- Impact / who would notice: the owner reconciling the cash register; a payout appears with no settlement behind it.

## subscriptions: deleting a subscription does not reverse its payment
- Test: `src/subscriptions/subscriptions.service.int-spec.ts` > `SUB-21 deleting does not reverse the cash register; sourceDetails becomes null`
- Current behavior: `remove` frees the attendance and deletes the subscription, but the `SUBSCRIPTION_IN` transaction and balance stay. The tx then has `sourceDetails: null`.
- Why it looks unintended: if a sale was entered by mistake (the usual reason to delete), the register keeps money that was never received. If it is a refund, the money that left isn't recorded.
- Impact / who would notice: the owner; the cash register balance drifts from the real cash.

## subscriptions: buying a TIME pass pays for ALL unpaid attendance, even outside its window
- Test: `src/subscriptions/subscriptions.service.int-spec.ts` > `SUB-13 TIME marks ALL unpaid attendance PAID, even outside [startsAt, endsAt)`
- Current behavior: on purchase, every UNPAID attendance of the trainee is marked PAID and linked to the new TIME sub, including attendance months before `startsAt` or after `endsAt`. The resolver (used for new attendance) only matches `startsAt <= trainedAt < endsAt`.
- Why it looks unintended: the two code paths disagree on what a TIME pass covers. A one-month pass can retroactively cover a whole year of unpaid visits.
- Impact / who would notice: the owner (lost revenue on old unpaid visits) and trainers (that pass's pro-rata value is spread over many more attendances, so each one pays less in settlements).

## subscriptions: deleting a subscription doesn't re-reconcile the freed attendance
- Test: `src/subscriptions/subscriptions.service.int-spec.ts` > `SUB-22 freed attendance is not re-reconciled against other active subscriptions`
- Current behavior: attendance that was paid by the deleted sub becomes UNPAID even if the trainee has another ACTIVE subscription with credits or a matching window.
- Why it looks unintended: buying a sub reconciles unpaid attendance, so the system clearly wants unpaid rows paid when a sub is available. Deletion skips that.
- Impact / who would notice: staff see UNPAID attendance for a trainee who has a valid pass; it gets paid only when the trainee buys yet another sub.

## attendance: a restored credit is not applied to other unpaid attendance
- Test: `src/attendance/attendance.service.int-spec.ts` > `ATT-23 the restored credit is not applied to the trainee's other UNPAID attendance`
- Current behavior: deleting a PAID PUNCH attendance gives the credit back to the sub, but the trainee's UNPAID attendance (which exists precisely because credits ran out) stays UNPAID.
- Why it looks unintended: same reasoning as SUB-22; the free credit and the unpaid visit coexist.
- Impact / who would notice: staff; the trainee looks like they owe a visit while having a credit left.

## attendance: future-dated and exact duplicate attendance are accepted
- Test: `src/attendance/attendance.service.int-spec.ts` > `ATT-08 future-dated and exact duplicate attendance are accepted; each consumes a credit`
- Current behavior: `create` accepts any `trainedAt`, including far in the future, and the same trainee + same `trainedAt` can be recorded any number of times. Each duplicate consumes a PUNCH credit.
- Why it looks unintended: a double-submit burns a trainee's credit and adds a payout line for the trainer.
- Impact / who would notice: trainees (lost credits), owner (overpaid trainers).

## accounts: an admin/trainer password reset counts as the user's own first change
- Test: `src/accounts/accounts.service.int-spec.ts` > `ACC-11 an admin reset still requires a phone and marks the initial password as updated`
- Current behavior: when someone else changes an account's password (`POST /accounts/:id/change-password` by ADMIN or TRAINER, no current password needed), the service sets `hasUpdatedInitialPassword = true`. If the target hasn't changed their initial password yet, the person doing the reset must also send a `phone`, which is written to the target's trainee profile.
- Why it looks unintended: the flag exists so users replace a password someone else chose. After a reset the staff member knows the password, yet the user is never prompted to change it. Requiring the resetter to type the trainee's phone looks like the self-service first-login rule leaking into the reset path.
- Impact / who would notice: security. Staff know working passwords for trainee accounts indefinitely. Combined with ACC-15 (TRAINER can reset any account, incl. ADMIN), a trainer can take over an admin account without the admin ever being asked to change the password.

## auth: login reveals that an account exists and is disabled, even with a wrong password
- Test: `src/auth/auth.service.int-spec.ts` > `AUTH-04 status is checked before the password, so a wrong password reveals a disabled account`; `test/e2e/auth.e2e-spec.ts` > `AUTH-04 a wrong password on a DISABLED account also reveals the status`
- Current behavior: `validateUser` checks `status !== ACTIVE` before comparing the password. Any password for a DISABLED account returns 401 `Account is not active (DISABLED)`; an unknown email returns `Invalid credentials`.
- Why it looks unintended: unknown email and wrong password deliberately share one message (AUTH-03), which suggests enumeration was meant to be avoided. The status branch undoes that for disabled accounts.
- Impact / who would notice: low. Someone guessing emails can tell which ones belong to disabled (e.g. deleted, see next entry) accounts.

## accounts: a deleted account's email can never be used again
- Test: `src/accounts/accounts.service.int-spec.ts` > `ACC-07 a deleted account keeps its email, so the email can never be provisioned again`
- Current behavior: `DELETE /accounts/:id` only sets `status = DISABLED` and unlinks the profiles; the row and its email stay. Provisioning a new account with that email (even for the same, now unlinked profile) returns 400 `Email is already used by another account`. The only way back is `PATCH /accounts/:id { status: 'ACTIVE' }` on the old row, which then has no profile links.
- Why it looks unintended: from the UI, "delete account, then re-create it" is the obvious way to fix a wrongly provisioned account, and it fails with a message that points at a different account.
- Impact / who would notice: staff re-provisioning a trainee or trainer who uses the same email; they need a different email or a manual DB fix.

## accounts: provisioning after a profile-side unlink fails with a misleading "email" error
- Test: `src/accounts/accounts.service.int-spec.ts` > `ACC-04 profile unlinked on the profile side only -> 400 with a misleading "email" message`
- Current behavior: `PATCH /trainers/:id { accountId: null }` (and the trainee equivalent) clears the profile's `accountId` but leaves `accounts.trainerProfileId` pointing at the profile. Provisioning a new account for that profile passes the `already has an account` check, then hits the unique index on `accounts.trainerProfileId`; the error is caught and reported as 400 `Cannot create account (email may already exist)`, even when the email is unused.
- Why it looks unintended: the two sides of the link disagree, and the message sends staff looking at the email instead of the real cause.
- Impact / who would notice: staff trying to give a profile a new account; there is no API path that clears the account side except deleting (disabling) the old account.

## settlements: period boundaries use server-local time, not Europe/Sofia
- Test: `src/settlements/settlements.service.int-spec.ts` > `SET-02 attendance at 2025-12-01 01:00 Sofia (23:00Z Nov 30) lands in November, not December`
- Current behavior: `getLocalDateInterval` builds `[periodStart 00:00, periodEnd+1 00:00)` in the **server** timezone. Under UTC (the Docker default, see `TEST_PLAN.md` Q1), attendance between 00:00 and 02:00/03:00 Sofia time on the first day of a month falls into the previous month's settlement.
- Why it looks unintended: everything else (attendance entry, `/attendance/dates`) treats gym time as Europe/Sofia.
- Impact / who would notice: trainers with late-night or very early sessions around month boundaries; amounts move between months. Not an issue if production sets `TZ=Europe/Sofia` (open question Q1). The Sofia behavior is pinned by `src/settlements/settlements.service.sofia-int-spec.ts` (DT-06, `npm run test:tz-sofia`).

## subscriptions: date-only `startsAt` is UTC midnight
- Test: `src/subscriptions/subscriptions.service.int-spec.ts` > `SUB-03 date-only startsAt is UTC midnight, not Europe/Sofia midnight`
- Current behavior: `startsAt: '2025-12-10'` is stored as `2025-12-10T00:00:00.000Z`, which is 02:00 Sofia time. A TIME pass therefore starts and ends 2 h (3 h in summer) late in gym time.
- Why it looks unintended: the Swagger example is a date-only string, and gym-local time is Sofia elsewhere.
- Impact / who would notice: minor; attendance between 00:00 and 02:00 Sofia on the first or last day of a TIME pass can resolve differently than expected.

## attendance: `trainedAt` strings that aren't `YYYY-MM-DDTHH:mm[:ss[.fff]]` skip the Sofia conversion
- Test: `src/attendance/attendance-time.util.spec.ts` > `DT-02 date-only trainedAt is UTC midnight, not Sofia` and `DT-02 trainedAt with a space instead of T is server-local time, not Sofia`
- Current behavior: only the exact `T` form without a zone is treated as Europe/Sofia. `'2025-01-15'` becomes `2025-01-15T00:00:00.000Z` (02:00 Sofia). `'2025-01-15 08:10'` is parsed by `new Date` in **server-local** time (08:10Z under UTC, i.e. 10:10 Sofia), while `'2025-01-15T08:10'` gives 06:10Z.
- Why it looks unintended: the function's purpose is to interpret zoneless input as gym time; two common spellings silently get a different zone. The batch endpoint only checks `IsString`, so both reach the service there.
- Impact / who would notice: staff or integrations sending dates without the `T`; attendance lands 2–3 hours off and can move to another day, which changes `/attendance/dates`, sessions and settlement periods.

## attendance: impossible dates and hours roll over instead of being rejected
- Test: `src/attendance/attendance-time.util.spec.ts` > `DT-02 impossible dates and hours roll over instead of being rejected`; `src/attendance/attendance-range.util.spec.ts` > `DT-03 month 13 and day 32 roll over silently instead of being rejected`
- Current behavior: `resolveTrainedAt({ trainedDate: '2025-02-30' })` → 2025-03-02 12:00 Sofia; `trainedAt: '2025-01-15T25:00'` → 2025-01-16 01:00 Sofia. `getLocalDateInterval('2025-13-01', …)` starts on 2026-01-01 and `'2025-01-32'` on 2025-02-01. Only zero/non-numeric parts and out-of-range `trainedTime` are rejected.
- Why it looks unintended: `trainedTime` is range-checked (24:00 → 400), so the same mistake in the date or in `trainedAt` was clearly meant to be an error too.
- Impact / who would notice: a typo records attendance on another day, or a report/settlement silently covers a different period than the one typed.

## settlements: an impossible period date (e.g. `2025-02-30`) returns 500 instead of 400
- Test: `test/e2e/settlements.e2e-spec.ts` > `SET-03 impossible date 2025-02-30 passes validation but Postgres rejects it -> 500, nothing persisted`
- Current behavior: `GenerateSettlementDto` only checks the `YYYY-MM-DD` shape, and `getLocalDateInterval` rolls `2025-02-30` over to 2025-03-02 without complaint (see the previous entry). `generate` then stores the **raw** string in the `date` columns `periodStart`/`periodEnd`, and Postgres rejects it (`22008 date/time field value out of range`). The client gets a generic 500; the transaction rolls back, so nothing is persisted. `TEST_PLAN.md` SET-03 expected a silent rollover; the observed result is a 500.
- Why it looks unintended: a bad date in the request is a client error (400 with a message the frontend can show), and other invalid periods (`from > to`, wrong shape) do return 400.
- Impact / who would notice: the admin generating a settlement who mistypes a date gets an unexplained server error. No data or money is affected.

## subscriptions cron: ended TIME passes become EXHAUSTED, never EXPIRED
- Test: `src/subscriptions/subscriptions.service.int-spec.ts` > `CRON-01 exhausts ACTIVE TIME subs with endsAt < now only and returns the count`
- Current behavior: the daily job sets `status = EXHAUSTED` on ACTIVE TIME subs whose `endsAt < now`. `SubscriptionStatus.EXPIRED` (and `CANCELLED`) exist in the enum but nothing in the codebase ever sets them.
- Why it looks unintended: `EXPIRED` is the natural status for a time-based pass that ran out; `EXHAUSTED` describes a PUNCH card with no credits left.
- Impact / who would notice: the frontend or reports that filter by status. Low impact today because both statuses are treated as "not active".

## accounts: trainer and admin accounts must send a phone on their first password change, and it is discarded
- Test: `src/accounts/accounts.service.int-spec.ts` > `ACC-10 trainer and ADMIN accounts must send a phone the first time, but it is not stored anywhere`
- Current behavior: `changePassword` requires a non-blank `phone` whenever `hasUpdatedInitialPassword` is false, for every role. Only accounts with a `traineeProfileId` store it. Trainer profiles have no phone column and the seeded ADMIN (`BootstrapService`) starts with `hasUpdatedInitialPassword = false`, so both must type a phone that goes nowhere.
- Why it looks unintended: the phone rule exists to collect trainee contact data.
- Impact / who would notice: trainers and the admin on their first password change; a pointless required field.

## accounts: a whitespace-only phone is stored as an empty string
- Test: `src/accounts/accounts.service.int-spec.ts` > `ACC-10 after the first change a whitespace-only phone is stored as an empty string, not null`
- Current behavior: after the first change `phone` is optional; `phone: '   '` is trimmed to `''` and written to the trainee profile instead of clearing it to null (`phone: null` does clear it).
- Why it looks unintended: two "no phone" values (`''` and `null`) now exist for the same meaning.
- Impact / who would notice: minor; anything that checks `phone !== null` (e.g. the frontend) treats the trainee as having a phone.

## trainee profiles: searching trainees by name, nickname or phone always fails (500)
- Test: `src/trainee-profiles/trainee-profiles.service.int-spec.ts` > `TRN-01 any non-blank search fails with a non-HTTP error (500); blank search is ignored`; `test/e2e/trainee-profiles.e2e-spec.ts` > `TRN-01 GET /trainees?search=%s -> 500 (the where uses columns that do not exist)`
- Current behavior: `list({ search })` builds an OR of `firstName ILIKE`, `lastName ILIKE` and `phone ILIKE`. The entity has no `firstName`/`lastName` columns (it has `name` and `nickname`), so TypeORM throws `EntityPropertyNotFoundError` for **every** non-blank search, phone searches included. It isn't an `HttpException`, so `GET /api/trainees?search=…` answers 500. A blank or whitespace-only search is ignored and returns the normal list.
- Why it looks unintended: the columns were renamed (or never existed) and the search was not updated. Nickname isn't searched at all.
- Impact / who would notice: staff using the trainee search box; every search shows an error. Confirmed over HTTP: `GET /api/trainees?search=Ivan` (or a phone number) answers 500.

## attendance sessions: startTime/endTime are one continuous range, not a daily time window
- Test: `src/attendance/attendance-read.service.int-spec.ts` > `ATR-11 startTime/endTime bound one continuous range, not a daily time window`
- Current behavior: `GET /attendance/sessions?startDate=2025-12-10&endDate=2025-12-11&startTime=08:00&endTime=09:00` returns everything from Dec 10 08:00 to Dec 11 09:00:59.999 (server time), including Dec 10 23:00 and Dec 11 06:00. Not listed in `TEST_PLAN.md` originally; found while writing ATR-11.
- Why it looks unintended: separate `startTime`/`endTime` query params next to a date range read like "between 08:00 and 09:00 on each day". If the UI only ever sends one day, there's no visible difference.
- Impact / who would notice: anyone filtering a multi-day range by time of day; the session list contains sessions outside the requested hours.

## attendance sessions: grouping and training-time slots use server time, not Europe/Sofia
- Test: `src/attendance/attendance-read.service.int-spec.ts` > `ATR-10 day, hour and slot matching use server-local time (UTC), not Sofia`
- Current behavior: the session `date`, the `custom:HH:mm` key and training-time slot matching all use `Date#getHours()`/`getDate()`, i.e. the server timezone. Under UTC (Docker default, `TEST_PLAN.md` Q1) an attendance at 18:30 Sofia (16:30Z) does **not** fall into an 18:00–19:00 training time and shows as a `custom:16:30` session; 00:30 Sofia attendance is listed under the previous day. The `startTime`/`endTime` filter is also server time (see `DT-04`).
- Why it looks unintended: training times and `trainedTime` are entered as gym-local (Sofia) times, and `/attendance/dates` groups by Sofia date.
- Impact / who would notice: staff viewing the sessions screen; attendance doesn't group under the configured training times and times look 2–3 h off. Not an issue if production sets `TZ=Europe/Sofia` (Q1). The Sofia behavior is pinned by `src/attendance/attendance-read.service.sofia-int-spec.ts` (DT-06, `npm run test:tz-sofia`).

## attendance dates: grouped by Sofia date but filtered by a server-time range
- Test: `src/attendance/attendance-read.service.int-spec.ts` > `ATR-01 grouped by Sofia date but filtered by a server-TZ (UTC) range`
- Current behavior: `GET /attendance/dates?from=2025-12-01&to=2025-12-31` selects rows in `[Dec 1 00:00, Jan 1 00:00)` server time (UTC) but labels each with its Sofia date. Attendance at 2026-01-01 01:30 Sofia (23:30Z Dec 31) is returned under the date `2026-01-01`, outside the requested range, and attendance at 2025-12-01 01:00 Sofia (23:00Z Nov 30) is missing.
- Why it looks unintended: the filter and the grouping use different timezones, so the response can contain days that weren't asked for and miss early-morning rows of the first day.
- Impact / who would notice: the calendar view (per-day counts / "has unpaid" badges) around midnight and month boundaries. Not an issue if production sets `TZ=Europe/Sofia` (Q1). The Sofia behavior is pinned by `src/attendance/attendance-read.service.sofia-int-spec.ts` (DT-06, `npm run test:tz-sofia`).

## attendance reports: deactivated trainees are listed, and a TIME pass that hasn't started counts as active
- Test: `src/attendance/attendance-read.service.int-spec.ts` > `ATR-20 includes deactivated trainees and counts a not-yet-started TIME pass as active`; `ATR-21 lastActiveSubscription is the newest sub of any status; deactivated trainees are listed`
- Current behavior: both `reports/inactive-trainees` and `reports/without-active-subscription` load **all** trainee profiles, including deactivated ones. "Active subscription" means ACTIVE + (PUNCH with credits > 0, or TIME with `endsAt > now`); `startsAt` is not checked, so a TIME pass that starts next month makes the trainee "active" today (reported with the full `remainingDays` until its end). The same definition is used by the trainee `overview` (TRN-07).
- Why it looks unintended: a deactivated trainee is someone the gym stopped tracking, so they shouldn't show up as "inactive" or "needs a subscription". A pass that hasn't started doesn't cover today's training (the resolver wouldn't use it, RES-02).
- Impact / who would notice: staff using the follow-up reports; former members clutter the lists, and a trainee with a pre-bought pass is hidden from "without active subscription" even though their attendance today is UNPAID.

## attendance reports: `lastActiveSubscription` is the newest subscription of any status
- Test: `src/attendance/attendance-read.service.int-spec.ts` > `ATR-21 lastActiveSubscription is the newest sub of any status; deactivated trainees are listed`
- Current behavior: for trainees without an active subscription, `lastActiveSubscription` is simply the subscription with the latest `startsAt`, whatever its status. A CANCELLED pass that was never used wins over an older EXHAUSTED one and is reported with its unused `remainingTrainings`.
- Why it looks unintended: the field name says "last active", i.e. the last pass the trainee actually used.
- Impact / who would notice: staff deciding what to sell next; minor today because nothing sets CANCELLED (see the cron entry), but it will matter once cancellation exists.

## trainee profiles: `accountId` isn't checked against the account and is never linked back
- Test: `src/trainee-profiles/trainee-profiles.service.int-spec.ts` > `TRN-03 accepts a TRAINER account id and never links the account back`; `TRN-03 an unknown accountId fails on the DB foreign key (non-HTTP error, 500)`
- Current behavior: `create` (and `update`) store any `accountId` that isn't used by another trainee, including a TRAINER account. The account's own `traineeProfileId` is not set, so that account's JWT keeps `traineeProfileId: null` and the TRAINEE can't reach their own data. An unknown `accountId` is only caught by the DB foreign key, which surfaces as a 500 instead of a 400/404.
- Why it looks unintended: the link is meant to be two-way (provisioning in `AccountsService` sets both sides), and only TRAINEE accounts should own a trainee profile.
- Impact / who would notice: staff linking an existing account from the trainee screen; the trainee then can't log in to their data, and a typo'd id gives a generic server error.

## trainee profiles: a deactivated trainee's account can still log in
- Test: `src/trainee-profiles/trainee-profiles.service.int-spec.ts` > `TRN-06 the deactivated trainee's linked account can still log in with its profile claim`; `test/e2e/trainee-profiles.e2e-spec.ts` > `TRN-06 after DELETE the linked account still logs in and reads its own data; no new attendance or subscriptions`
- Current behavior: `DELETE /trainees/:id` only sets `isActive = false` on the profile. The linked account stays ACTIVE, `validateUser` succeeds and the JWT still carries `traineeProfileId`, so the trainee keeps access to their own subscriptions, attendance and insights.
- Why it looks unintended: deactivating a member usually means revoking their app access too.
- Impact / who would notice: former members keep app access until someone also disables the account (`PATCH /accounts/:id`).

## plans: a whitespace-only title is stored as an empty string
- Test: `src/plans/plans.service.int-spec.ts` > `PLN-03 a whitespace-only title passes the DTO and is stored as an empty string`; `test/e2e/plans.e2e-spec.ts` > `PLN-03 a whitespace-only title passes the DTO and is stored as ""`
- Current behavior: `CreatePlanDto.title` is `@IsNotEmpty()`, which accepts `'   '`. The service then trims it to `''` and saves a plan with an empty title.
- Why it looks unintended: `IsNotEmpty` plus trimming shows a non-empty title was intended.
- Impact / who would notice: minor; a plan with a blank name in the plan picker and in reports (`planName: ''`).

## trainer profiles: `accountId` isn't checked against the account and is never linked back
- Test: `src/trainer-profiles/trainer-profiles.service.int-spec.ts` > `TRP-01 accepts any account id (even a TRAINEE account) and never links the account back`; `TRP-01 an unknown accountId fails on the DB foreign key (non-HTTP error, 500)`; `TRP-01 unlinking with accountId: null leaves the account pointing at the trainer (JWT keeps the claim)`
- Current behavior: same pattern as the trainee entry above. `POST/PATCH /trainers` store any `accountId` that no other trainer uses, including a TRAINEE account. The account's `trainerProfileId` is not set, so a TRAINER account linked this way can't log in (403 `NOT_LINKED_MESSAGE`: since self-registration, a non-admin account needs the account-side link to log in). An unknown id is only caught by the DB foreign key (500). Unlinking with `accountId: null` clears only the trainer side: the account keeps `trainerProfileId`, and its JWT still carries the claim (the provisioning consequence is the ACC-04 entry above).
- Why it looks unintended: provisioning (`AccountsService.provisionForProfile`) sets both sides of the link, and only TRAINER accounts should own a trainer profile. The two sides can drift apart through this endpoint.
- Impact / who would notice: admins linking or unlinking trainer accounts from the trainer screen. A linked trainer gets no trainer-scoped access (settlement lines, own sessions); an "unlinked" trainer keeps it.

## trainer profiles: a deactivated trainer's account can still log in
- Test: `src/trainer-profiles/trainer-profiles.service.int-spec.ts` > `TRP-03 the deactivated trainer's account can still log in with its TRAINER role and profile claim`
- Current behavior: `DELETE /trainers/:id` only sets `isActive = false` on the profile. The linked account stays ACTIVE, `validateUser` succeeds and the JWT still has `role: TRAINER` and `trainerProfileId`. The trainer can no longer be used for new attendance (400), but keeps every TRAINER read/write permission that doesn't go through the profile check (trainee list, subscriptions, settlement headers, training times, …).
- Why it looks unintended: same as the trainee entry. Deactivating staff usually means revoking their access, and a TRAINER role can create and delete subscriptions.
- Impact / who would notice: the owner, when a trainer leaves. Access lasts until someone also disables the account (`DELETE /accounts/:id`).

## gym locations / gym subscriptions: `includeInactive=1` passes validation but is treated as false
- Test: `src/gym-locations/gym-locations.service.int-spec.ts` > `GL-02 includeInactive '1' passes query validation but still hides inactive locations`; `src/gym-subscriptions/gym-subscriptions.service.int-spec.ts` > `GL-02 includeInactive '1' passes query validation but still hides inactive ones`; `test/e2e/gym-locations.e2e-spec.ts` > `GL-02 includeInactive=1 passes the DTO but is treated as false` (both resources)
- Current behavior: the list query DTOs use `@IsBooleanString()`, which accepts `'true'`, `'false'`, `'1'` and `'0'`. Both services then check `includeInactive === 'true'`, so `?includeInactive=1` returns 200 with only active rows.
- Why it looks unintended: the validator explicitly allows `1` as a boolean, and the service silently treats it as false instead of rejecting it.
- Impact / who would notice: low. Only a client that sends `1` is affected; it gets a list with the inactive rows missing and no error. Which value the front sends was not checked against the front repo.

## trainee profiles: re-sending a trainee's own, now inactive, gym subscription rejects the whole edit
- Test: `src/gym-subscriptions/gym-subscriptions.service.int-spec.ts` > `GS-01 re-sending the trainee's own (now inactive) gym subscription in an update -> 400`
- Current behavior: after a gym subscription is deactivated, trainees that have it keep it. But `PATCH /trainees/:id` with `gymSubscriptionId` equal to the trainee's **current** value is checked like a new assignment and fails with 400 `Gym subscription not found or inactive`. The whole update is rejected (e.g. a name change in the same request is not saved). Omitting the field works.
- Why it looks unintended: the trainee isn't being assigned anything new. An edit form that sends back every field (including the current gym subscription) can no longer save that trainee until staff pick a different gym subscription or clear it.
- Impact / who would notice: staff editing trainees after a gym subscription method is retired, if the front sends `gymSubscriptionId` unchanged. Not verified against the front repo.

## training times: PATCH returns a mix of `HH:mm` and `HH:mm:ss`
- Test: `src/training-times/training-times.service.int-spec.ts` > `TT-04 update returns the sent field as HH:mm and the untouched one as HH:mm:ss`
- Current behavior: Postgres `time` columns read back as `'HH:mm:ss'`. `POST` returns the input strings (`'09:00'`), `GET` returns `'09:00:00'`, and `PATCH { endTime: '11:00' }` returns `{ startTime: '09:00:00', endTime: '11:00' }`, two formats in one body.
- Why it looks unintended: one resource, one field type, three possible shapes depending on the route and which fields were sent.
- Impact / who would notice: low. Frontend code that compares or displays the PATCH response without normalizing (e.g. `startTime === '09:00'`) would get it wrong until the next reload.

## trainee/trainer profiles: PATCH requires `name`, so partial updates fail
- Test: `test/e2e/trainee-profiles.e2e-spec.ts` > `TRN-04 PATCH { isActive: false } without name -> 400; the trainee stays active`; `test/e2e/trainer-profiles.e2e-spec.ts` > `TRP-02 PATCH { nickname } without name -> 400; nothing changes`
- Current behavior: `UpdateTraineeDto.name` and `UpdateTrainerDto.name` have no `@IsOptional()`, so every PATCH without `name` is rejected with 400 (`name must be longer than or equal to 2 characters`, `name must be a string`). Every other field on those DTOs is optional, and the services handle `name` being absent.
- Why it looks unintended: a PATCH DTO whose other fields are all optional, next to services written for partial updates, reads like a copy of the create DTO where one decorator was missed.
- Impact / who would notice: frontend or integration code that sends only the changed field (e.g. an "activate/deactivate" toggle) gets a 400. Not visible if the front always sends the whole form; not checked against the front repo.

## plans: `?active=` values other than `true` are treated as `false`
- Test: `test/e2e/plans.e2e-spec.ts` > `PLN-07 ?active=%s is treated as false (inactive only), not 400`
- Current behavior: the plans controller parses `active` by hand: missing → all plans, `'true'` → active only, **anything else** (`yes`, `1`, `TRUE`, an empty value) → inactive only. Trainees and trainers use the same parsing (TRN-02, TRP-05). Gym locations/subscriptions validate the same kind of flag with a DTO and answer 400 instead (GL-02).
- Why it looks unintended: a typo or a different boolean spelling silently returns the opposite set instead of an error.
- Impact / who would notice: low; a client sending `active=1` gets only the inactive plans and no error.

## accounts: `GET /accounts/:id` for an unknown id answers 200 with an empty body
- Test: `test/e2e/accounts.e2e-spec.ts` > `ACC-13 an unknown id -> 200 with an empty body, not 404`
- Current behavior: the controller returns `null` when `findById` finds nothing, and Nest sends `200` with an empty body (no JSON). Every other "get by id" route, including `GET /accounts/:id/password-status`, answers 404.
- Why it looks unintended: inconsistent with the rest of the API and with the service's own `Account not found` 404 used by update/delete/password routes.
- Impact / who would notice: frontend code that calls `res.json()` or reads fields on the result gets a parse error or `null` instead of a 404 it can handle.

## gym locations / gym subscriptions: a deactivated row can't be reactivated
- Test: `test/e2e/gym-locations.e2e-spec.ts` > `GL-03 there is no way to reactivate: PATCH { isActive: true } -> 400, still inactive` (both resources)
- Current behavior: `DELETE` sets `isActive = false`, but `isActive` isn't on either update DTO, so `PATCH { isActive: true }` is rejected (`property isActive should not exist`) and no other route turns it back on. Renaming an inactive row works and keeps it inactive.
- Why it looks unintended: soft delete is normally paired with a way to undo it; plans, trainees and trainers all accept `isActive` on PATCH.
- Impact / who would notice: staff who deactivate a location or gym subscription by mistake must create a new one (losing the link to historical attendance) or fix it in the DB.

## cross-cutting: non-UUID path ids return 500 instead of 400/404
- Test: `test/e2e/cross-cutting.e2e-spec.ts` > `X-03 non-UUID path id on %s %s reaches Postgres -> 500`
- Current behavior: no route uses `ParseUUIDPipe`, so a path id like `abc` reaches Postgres, which rejects it (`invalid input syntax for type uuid`), and the client gets a generic 500. Checked on `GET /plans/:id`, `GET /trainees/:id`, `DELETE /subscriptions/:id` and `GET /settlements/:id`.
- Why it looks unintended: a malformed id is a client error; the same request with a well-formed unknown UUID answers 404 with a useful message.
- Impact / who would notice: low. Mostly noise in error logs and monitoring; a frontend bug that builds a wrong URL shows a generic server error.

## auth: a valid login with a password shorter than 3 characters gets 400
- Test: `test/e2e/auth.e2e-spec.ts` > `AUTH-06 valid credentials with a password shorter than 3 chars -> 400 (MinLength runs after auth)`
- Current behavior: `LocalAuthGuard` authenticates before the `ValidationPipe` runs. For an account whose real password is 1–2 characters, the right password passes the guard and then fails `LoginDto`'s `MinLength(3)` (400), while a wrong short password gets 401. Such passwords can't be set through the API today (`MinLength(8)` everywhere), only through the seed (`SEED_ADMIN_PASSWORD`) or the DB.
- Why it looks unintended: the DTO check can never protect anything, because authentication already happened; it only produces a confusing 400 for a correct password. It also tells a caller that a short password was right.
- Impact / who would notice: very low; only an admin seeded with a 1–2 character password (the example `.env` uses `admin`, 5 characters).

---

# Fixed

Entries move here once the behavior is fixed. The tests named here now assert the corrected behavior.

## subscriptions cron: one failed run crashed the API process and the daily job was never rescheduled (fixed in #49)
- Test: `src/subscriptions/subscriptions-cron.service.int-spec.ts` > `CRON-03 a failed run is handled and the next run is still scheduled for 02:00 UTC the following day`; `CRON-03 a failure after a successful run does not stop the schedule either`
- Old behavior: the timer callback was `() => { void this.runAndScheduleNext(); }`, and `runAndScheduleNext` was `await this.exhaustPastEndTimeSubscriptions(); this.scheduleNextRun();` with no `try/catch`. If the UPDATE threw (DB restart, connection drop, lock timeout at 02:00 UTC), the promise rejected and nothing handled it. Node's default `--unhandled-rejections=throw` (Node 15+, so Node 20 and 24) turned that into a process crash (exit code 1). Even with an `unhandledRejection` handler, `scheduleNextRun()` was skipped, so the job never ran again until the app restarted. No characterization test was committed: Jest fails any test with an unhandled rejection, so the old behavior was reproduced outside Jest against `dist/`.
- Fix: `runAndScheduleNext` catches the error, logs it (`Logger.error` with the stack) and calls `scheduleNextRun()` from `finally`, so it never rejects and the next run is always 02:00 UTC the following day. CRON-03 makes the run fail by renaming the `subscriptions` table away for the duration of the run (a real DB error, no mocks). Before the fix both tests failed (unhandled `QueryFailedError` + no next run); a script against `dist/` on Node 24 exited with code 1 before the fix and stays up after it.
- Remaining impact: none for data. A failed day only delays exhaustion of ended TIME passes to the next 02:00 UTC run, as a missed run always did. The failure is now only visible in the logs.

## attendance: 00:xx gym-local times were stored one day early on Node 20 (fixed in #38)
- Test: `src/attendance/attendance-timezone.util.spec.ts` > `DT-01 00:xx gym-local times convert to the same day, not one day early`; `src/attendance/attendance-time.util.spec.ts` > `DT-02 a 00:xx Sofia trainedTime or zoneless trainedAt stays on its own day`
- Old behavior: `fromGymLocalToUtc` read the Sofia wall clock with `Intl.DateTimeFormat('en-CA', { hour12: false, … })`. On Node 20 (ICU 78.2; `.nvmrc`, CI and the `node:20-alpine` image) that resolves to hour cycle `h24`, so midnight was rendered as hour **24** of the same date. Every gym-local time from 00:00 to 00:59 then converted to an instant exactly 24 h too early. Example: `trainedDate 2025-01-15` + `trainedTime 00:30` was stored as `2025-01-13T22:30Z` (Jan 14 00:30 Sofia). Zoneless `trainedAt: '…T00:xx'` was affected the same way. Node 22 resolves `h23` and was not affected. The tests were first written on Node 22, and CI on Node 20 exposed the bug.
- Fix: the formatter now asks for `hourCycle: 'h23'` explicitly, so the result no longer depends on the runtime's locale data. Verified on Node 20 and 22 (and the DT-01/DT-02 regressions pass on Node 24, the runtime since Nov 2026, whose ICU 78.3 resolves `h23` for `hour12: false` anyway): every wall-clock minute of 2025 in Sofia converts back to its original instant (except the documented fall-back overlap hour, DT-01).
- Remaining impact: **attendance already stored by production through these inputs is still one day early.** It can't be repaired automatically. A stored 00:xx Sofia instant is either a shifted row (zoneless input) or a correct one (input with an explicit zone, or "now"), and the database doesn't record which. Settlements, TIME-pass payments and reports computed from such rows are not recalculated.

