# Test notes: behavior that looks unintended

Each entry is pinned by a characterization test marked `// CHARACTERIZATION: possibly unintended`. The tests assert **current** behavior. Fixing one of these means first changing the test to the desired behavior (it will fail), then fixing the code, and updating the entry here in the same PR. Format: see `CLAUDE.md` § Testing rules.

Ordered by impact (money and data integrity first).

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

## settlements: period boundaries use server-local time, not Europe/Sofia
- Test: `src/settlements/settlements.service.int-spec.ts` > `SET-02 attendance at 2025-12-01 01:00 Sofia (23:00Z Nov 30) lands in November, not December`
- Current behavior: `getLocalDateInterval` builds `[periodStart 00:00, periodEnd+1 00:00)` in the **server** timezone. Under UTC (the Docker default, see `TEST_PLAN.md` Q1), attendance between 00:00 and 02:00/03:00 Sofia time on the first day of a month falls into the previous month's settlement.
- Why it looks unintended: everything else (attendance entry, `/attendance/dates`) treats gym time as Europe/Sofia.
- Impact / who would notice: trainers with late-night or very early sessions around month boundaries; amounts move between months. Not an issue if production sets `TZ=Europe/Sofia` (open question Q1).

## subscriptions: date-only `startsAt` is UTC midnight
- Test: `src/subscriptions/subscriptions.service.int-spec.ts` > `SUB-03 date-only startsAt is UTC midnight, not Europe/Sofia midnight`
- Current behavior: `startsAt: '2025-12-10'` is stored as `2025-12-10T00:00:00.000Z`, which is 02:00 Sofia time. A TIME pass therefore starts and ends 2 h (3 h in summer) late in gym time.
- Why it looks unintended: the Swagger example is a date-only string, and gym-local time is Sofia elsewhere.
- Impact / who would notice: minor; attendance between 00:00 and 02:00 Sofia on the first or last day of a TIME pass can resolve differently than expected.

## subscriptions cron: ended TIME passes become EXHAUSTED, never EXPIRED
- Test: `src/subscriptions/subscriptions.service.int-spec.ts` > `CRON-01 exhausts ACTIVE TIME subs with endsAt < now only and returns the count`
- Current behavior: the daily job sets `status = EXHAUSTED` on ACTIVE TIME subs whose `endsAt < now`. `SubscriptionStatus.EXPIRED` (and `CANCELLED`) exist in the enum but nothing in the codebase ever sets them.
- Why it looks unintended: `EXPIRED` is the natural status for a time-based pass that ran out; `EXHAUSTED` describes a PUNCH card with no credits left.
- Impact / who would notice: the frontend or reports that filter by status. Low impact today because both statuses are treated as "not active".
