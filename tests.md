# API Tests (Realistic Scenario)

> Requirements tested:
> - Auth: ADMIN bootstrap + login, invited account activation, RBAC sanity checks
> - Profiles: trainers & trainees use `name` and optional `nickname`
> - Locations: attendance can store `locationId` (informational)
> - Plans: PUNCH and TIME
> - Attendance: batch input with date+time
> - Subscription resolution: oldest purchase first
> - Late payments: UNPAID -> PAID reconciliation on subscription purchase
> - Punch credit consumption + exhaustion
> - Sessions endpoint grouping
> - Overview endpoint
> - Settlements:
    >   - PUNCH allocations immediately
>   - TIME allocations only after subscription ends (Option 1)
>   - Settlement `info.notReportableTimeAttendance` and pending subs list

## 0) Base URL and helper vars

```bash
export API="http://localhost:3000/api"

export S1_DATE="2025-12-12"
export S2_DATE="2025-12-14"
export S3_DATE="2025-12-16"
export S4_DATE="2025-12-18"
export S5_DATE="2025-12-20"

export JAN_FROM="2026-01-01"
export JAN_TO="2026-01-31"

export DEC_FROM="2025-12-01"
export DEC_TO="2025-12-31"
```

## Auth bootstrap: login as ADMIN

```bash
export ADMIN_EMAIL="admin"
export ADMIN_PASS="admin"

export ADMIN_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" | jq -r '.accessToken')

test -n "$ADMIN_TOKEN" && echo "✅ ADMIN_TOKEN acquired"
curl -s "$API/auth/me" -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

Expected:
- role: "ADMIN"
- trainerProfileId: null
- traineeProfileId: null

## Create trainer profiles (Velcho, Vito, Krasi)
> Use ADMIN token (or TRAINER token if you allow trainers to manage trainers).

```bash
export T_VELCHO=$(curl -s -X POST "$API/trainers" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Velcho"}' | jq -r '.id')

export T_VITO=$(curl -s -X POST "$API/trainers" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Vito"}' | jq -r '.id')

export T_KRASI=$(curl -s -X POST "$API/trainers" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Krasi"}' | jq -r '.id')

test -n "$T_VELCHO" && test -n "$T_VITO" && test -n "$T_KRASI" && echo "✅ trainers created"
echo "T_VELCHO=$T_VELCHO"
echo "T_VITO=$T_VITO"
echo "T_KRASI=$T_KRASI"
```

## Create trainee profiles (Anton, Ani, Adi, Dido)
```bash
export TR_ANTON=$(curl -s -X POST "$API/trainees" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Anton","phone":"0877777777"}' | jq -r '.id')

export TR_ANI=$(curl -s -X POST "$API/trainees" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Ani","phone":"0899999999"}' | jq -r '.id')

export TR_ADI=$(curl -s -X POST "$API/trainees" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Adi","phone":"0888888888"}' | jq -r '.id')

export TR_DIDO=$(curl -s -X POST "$API/trainees" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Dido","phone":"0876767676"}' | jq -r '.id')

test -n "$TR_ANTON" && test -n "$TR_ANI" && test -n "$TR_ADI" && test -n "$TR_DIDO" && echo "✅ trainees created"
echo "TR_ANTON=$TR_ANTON"
echo "TR_ANI=$TR_ANI"
echo "TR_ADI=$TR_ADI"
echo "TR_DIDO=$TR_DIDO"
```

## Create accounts (TRAINER + TRAINEE) and activate them (auth logic tests)
### Create invited TRAINER account linked to Velcho
```bash
export ACC_VELCHO=$(curl -s -X POST "$API/accounts" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"role\":\"TRAINER\",\"trainerProfileId\":\"$T_VELCHO\"}" | jq -r '.id')

echo "ACC_VELCHO=$ACC_VELCHO"

curl -s "$API/accounts/$ACC_VELCHO" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

Activate it
```bash
export VELCHO_EMAIL="velcho@theindex.local"
export VELCHO_PASS="velcho123"

curl -s -X POST "$API/accounts/$ACC_VELCHO/activate" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$VELCHO_EMAIL\",\"password\":\"$VELCHO_PASS\"}" | jq
```

Login as trainer:
```bash
export TRAINER_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$VELCHO_EMAIL\",\"password\":\"$VELCHO_PASS\"}" | jq -r '.accessToken')

test -n "$TRAINER_TOKEN" && echo "✅ TRAINER_TOKEN acquired"
curl -s "$API/auth/me" -H "Authorization: Bearer $TRAINER_TOKEN" | jq
```

Expected:
- role: "TRAINER"
- trainerProfileId == $T_VELCHO

### Create invited TRAINEE account linked to Anton
```bash
export ACC_ANTON=$(curl -s -X POST "$API/accounts" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"role\":\"TRAINEE\",\"traineeProfileId\":\"$TR_ANTON\"}" | jq -r '.id')

export ANTON_EMAIL="anton@theindex.local"
export ANTON_PASS="anton123"

curl -s -X POST "$API/accounts/$ACC_ANTON/activate" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ANTON_EMAIL\",\"password\":\"$ANTON_PASS\"}" | jq

export ANTON_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ANTON_EMAIL\",\"password\":\"$ANTON_PASS\"}" | jq -r '.accessToken')

test -n "$ANTON_TOKEN" && echo "✅ ANTON_TOKEN acquired"
curl -s "$API/auth/me" -H "Authorization: Bearer $ANTON_TOKEN" | jq
```

### Negative auth checks
Wrong password:
```bash
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$VELCHO_EMAIL\",\"password\":\"wrong\"}" | jq
```

Disable account and verify login fails:
```bash
curl -s -X PATCH "$API/accounts/$ACC_VELCHO/status" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"DISABLED"}' | jq

curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$VELCHO_EMAIL\",\"password\":\"$VELCHO_PASS\"}" | jq

curl -s -X PATCH "$API/accounts/$ACC_VELCHO/status" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"ACTIVE"}' | jq

export TRAINER_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$VELCHO_EMAIL\",\"password\":\"$VELCHO_PASS\"}" | jq -r '.accessToken')
```

From now on, we’ll use TRAINER_TOKEN for realistic operations:
```bash
export TOKEN="$TRAINER_TOKEN"
```

## Create gym locations
```bash
export LOC_1=$(curl -s -X POST "$API/gym-locations" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"West","address":"Plovdiv"}' | jq -r '.id')

test -n "$LOC_1" && echo "✅ location created: $LOC_1"
```

## Create plans
```bash
export PLAN_PUNCH_8=$(curl -s -X POST "$API/plans" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"PUNCH","title":"8 trainings","priceCents":9000,"credits":8}' | jq -r '.id')

export PLAN_PUNCH_12=$(curl -s -X POST "$API/plans" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"PUNCH","title":"12 trainings","priceCents":12000,"credits":12}' | jq -r '.id')

export PLAN_PUNCH_16=$(curl -s -X POST "$API/plans" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"PUNCH","title":"16 trainings","priceCents":15000,"credits":16}' | jq -r '.id')

export PLAN_TIME_30=$(curl -s -X POST "$API/plans" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"TIME","title":"30 days unlimited","priceCents":16000,"durationDays":30}' | jq -r '.id')

test -n "$PLAN_PUNCH_8" && test -n "$PLAN_PUNCH_12" && test -n "$PLAN_PUNCH_16" && test -n "$PLAN_TIME_30" && echo "✅ plans created"
echo "PLAN_PUNCH_8=$PLAN_PUNCH_8"
echo "PLAN_PUNCH_12=$PLAN_PUNCH_12"
echo "PLAN_PUNCH_16=$PLAN_PUNCH_16"
echo "PLAN_TIME_30=$PLAN_TIME_30"
```

## All trainees buy subscriptions
Rules:
- Adi & Dido buy PUNCH 8
- Ani buys PUNCH 16
- Anton buys TIME 30

We start them on 2025-12-10 so December attendance is within and TIME ends in January.

```bash
export START="2025-12-10"

export SUB_ADI_P8=$(curl -s -X POST "$API/trainees/$TR_ADI/subscriptions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"planId\":\"$PLAN_PUNCH_8\",\"startsAt\":\"$START\"}" | jq -r '.id')

export SUB_DIDO_P8=$(curl -s -X POST "$API/trainees/$TR_DIDO/subscriptions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"planId\":\"$PLAN_PUNCH_8\",\"startsAt\":\"$START\"}" | jq -r '.id')

export SUB_ANI_P16=$(curl -s -X POST "$API/trainees/$TR_ANI/subscriptions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"planId\":\"$PLAN_PUNCH_16\",\"startsAt\":\"$START\"}" | jq -r '.id')

export SUB_ANTON_T30=$(curl -s -X POST "$API/trainees/$TR_ANTON/subscriptions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"planId\":\"$PLAN_TIME_30\",\"startsAt\":\"$START\"}" | jq -r '.id')

test -n "$SUB_ADI_P8" && test -n "$SUB_DIDO_P8" && test -n "$SUB_ANI_P16" && test -n "$SUB_ANTON_T30" && echo "✅ subscriptions purchased"
echo "SUB_ADI_P8=$SUB_ADI_P8"
echo "SUB_DIDO_P8=$SUB_DIDO_P8"
echo "SUB_ANI_P16=$SUB_ANI_P16"
echo "SUB_ANTON_T30=$SUB_ANTON_T30"
```

Assert remaining credits for punch subs (initial should match plan credits):
```bash
curl -s "$API/trainees/$TR_ADI/subscriptions"  -H "Authorization: Bearer $TOKEN" | jq -e '.[0].remainingCredits==8'  >/dev/null && echo "✅ Adi credits=8"
curl -s "$API/trainees/$TR_DIDO/subscriptions" -H "Authorization: Bearer $TOKEN" | jq -e '.[0].remainingCredits==8'  >/dev/null && echo "✅ Dido credits=8"
curl -s "$API/trainees/$TR_ANI/subscriptions"  -H "Authorization: Bearer $TOKEN" | jq -e '.[0].remainingCredits==16' >/dev/null && echo "✅ Ani credits=16"
```

## Batch sessions (5 sessions, varying attendance, varying trainers)
Session 1 (Velcho): all 4 trainees
```bash
curl -s -X POST "$API/attendance/batch" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{
  "trainerId": "'"$T_VELCHO"'",
  "locationId": "'"$LOC_1"'",
  "trainedDate": "'"$S1_DATE"'",
  "trainedTime": "18:30",
  "traineeIds": ["'"$TR_ANTON"'","'"$TR_ANI"'","'"$TR_ADI"'","'"$TR_DIDO"'"]
}' | jq
```
Session 2 (Vito): only Anton
```bash
curl -s -X POST "$API/attendance/batch" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{
  "trainerId": "'"$T_VITO"'",
  "locationId": "'"$LOC_1"'",
  "trainedDate": "'"$S2_DATE"'",
  "trainedTime": "19:00",
  "traineeIds": ["'"$TR_ANTON"'"]
}' | jq
```

Session 3 (Krasi): Anton + Ani
```bash
curl -s -X POST "$API/attendance/batch" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{
  "trainerId": "'"$T_KRASI"'",
  "locationId": "'"$LOC_1"'",
  "trainedDate": "'"$S3_DATE"'",
  "trainedTime": "18:30",
  "traineeIds": ["'"$TR_ANTON"'","'"$TR_ANI"'"]
}' | jq
```

Session 4 (Velcho): only Anton
```bash
curl -s -X POST "$API/attendance/batch" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{
  "trainerId": "'"$T_VELCHO"'",
  "locationId": "'"$LOC_1"'",
  "trainedDate": "'"$S4_DATE"'",
  "trainedTime": "19:00",
  "traineeIds": ["'"$TR_ANTON"'"]
}' | jq
```

Session 5 (Vito): all 4 trainees
```bash
curl -s -X POST "$API/attendance/batch" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{
  "trainerId": "'"$T_VITO"'",
  "locationId": "'"$LOC_1"'",
  "trainedDate": "'"$S5_DATE"'",
  "trainedTime": "18:30",
  "traineeIds": ["'"$TR_ANTON"'","'"$TR_ANI"'","'"$TR_ADI"'","'"$TR_DIDO"'"]
}' | jq
```

## Verify subscriptions and consumption are accurate
Expected attendance counts in December:
- Anton (TIME): Session 1,2,3,4,5 = 5 attendances
- Ani (PUNCH15): Session 1,3,5 = 3 attendances
- Adi (PUNCH8): Session 1,5 = 2 attendances
- Dido (PUNCH8): Session 1,5 = 2 attendances

Verify per trainee:
```bash
curl -s "$API/attendance?date=$S1_DATE" -H "Authorization: Bearer $TOKEN" | jq
curl -s "$API/attendance?date=$S5_DATE" -H "Authorization: Bearer $TOKEN" | jq

export ANTON_COUNT=$(for d in $S1_DATE $S2_DATE $S3_DATE $S4_DATE $S5_DATE; do curl -s "$API/attendance?date=$d&traineeId=$TR_ANTON" -H "Authorization: Bearer $TOKEN"; done | jq -s 'add | length')
export ANI_COUNT=$(for d in $S1_DATE $S2_DATE $S3_DATE $S4_DATE $S5_DATE; do curl -s "$API/attendance?date=$d&traineeId=$TR_ANI" -H "Authorization: Bearer $TOKEN"; done | jq -s 'add | length')
export ADI_COUNT=$(for d in $S1_DATE $S2_DATE $S3_DATE $S4_DATE $S5_DATE; do curl -s "$API/attendance?date=$d&traineeId=$TR_ADI" -H "Authorization: Bearer $TOKEN"; done | jq -s 'add | length')
export DIDO_COUNT=$(for d in $S1_DATE $S2_DATE $S3_DATE $S4_DATE $S5_DATE; do curl -s "$API/attendance?date=$d&traineeId=$TR_DIDO" -H "Authorization: Bearer $TOKEN"; done | jq -s 'add | length')

echo "Anton attendances=$ANTON_COUNT (expected 5)"
echo "Ani attendances=$ANI_COUNT (expected 3)"
echo "Adi attendances=$ADI_COUNT (expected 2)"
echo "Dido attendances=$DIDO_COUNT (expected 2)"
```

Verify punch credits decreased:
- Adi: 8 - 2 = 6
- Dido: 8 - 2 = 6
- Ani: 16 - 3 = 13

```bash
curl -s "$API/trainees/$TR_ADI/subscriptions"  -H "Authorization: Bearer $TOKEN" | jq -e '.[0].remainingCredits==6'  >/dev/null && echo "✅ Adi remainingCredits=6"
curl -s "$API/trainees/$TR_DIDO/subscriptions" -H "Authorization: Bearer $TOKEN" | jq -e '.[0].remainingCredits==6'  >/dev/null && echo "✅ Dido remainingCredits=6"
curl -s "$API/trainees/$TR_ANI/subscriptions"  -H "Authorization: Bearer $TOKEN" | jq -e '.[0].remainingCredits==13' >/dev/null && echo "✅ Ani remainingCredits=13"
```

Anton TIME should not have remainingCredits:
```bash
curl -s "$API/trainees/$TR_ANTON/subscriptions" -H "Authorization: Bearer $TOKEN" | jq
```

## Create new trainee: Ivan
```bash
export TR_IVAN=$(curl -s -X POST "$API/trainees" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Ivan"}' | jq -r '.id')

test -n "$TR_IVAN" && echo "✅ Ivan created: $TR_IVAN"
```

## Ivan trains 2 times without paying (UNPAID)
Choose dates in December so settlement includes them:
```bash
export IVAN_D1="2025-12-22"
export IVAN_D2="2025-12-23"

curl -s -X POST "$API/attendance" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"traineeId\":\"$TR_IVAN\",\"trainerId\":\"$T_VELCHO\",\"locationId\":\"$LOC_1\",\"trainedDate\":\"$IVAN_D1\",\"trainedTime\":\"18:30\"}" | jq

curl -s -X POST "$API/attendance" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"traineeId\":\"$TR_IVAN\",\"trainerId\":\"$T_VITO\",\"locationId\":\"$LOC_1\",\"trainedDate\":\"$IVAN_D2\",\"trainedTime\":\"18:30\"}" | jq
```

Assert both are UNPAID:
```bash
curl -s "$API/attendance?date=$IVAN_D1&traineeId=$TR_IVAN" -H "Authorization: Bearer $TOKEN" | jq -e 'all(.[]; .paymentStatus=="UNPAID")' >/dev/null && echo "✅ Ivan D1 UNPAID"
curl -s "$API/attendance?date=$IVAN_D2&traineeId=$TR_IVAN" -H "Authorization: Bearer $TOKEN" | jq -e 'all(.[]; .paymentStatus=="UNPAID")' >/dev/null && echo "✅ Ivan D2 UNPAID"
```

## Ivan buys PUNCH 8 trainings (unpaid should become PAID via your current logic)

```bash
export SUB_IVAN_P8=$(curl -s -X POST "$API/trainees/$TR_IVAN/subscriptions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"planId\":\"$PLAN_PUNCH_8\",\"startsAt\":\"$IVAN_D2\"}" | jq -r '.id')

echo "SUB_IVAN_P8=$SUB_IVAN_P8"
```

Verify Ivan’s 2 previously UNPAID attendances are now PAID:
```bash
curl -s "$API/attendance?date=$IVAN_D1&traineeId=$TR_IVAN" -H "Authorization: Bearer $TOKEN" | jq -e 'all(.[]; .paymentStatus=="PAID")' >/dev/null && echo "✅ Ivan D1 now PAID"
curl -s "$API/attendance?date=$IVAN_D2&traineeId=$TR_IVAN" -H "Authorization: Bearer $TOKEN" | jq -e 'all(.[]; .paymentStatus=="PAID")' >/dev/null && echo "✅ Ivan D2 now PAID"
```

Verify credits: 8 - 2 = 6
```bash
curl -s "$API/trainees/$TR_IVAN/subscriptions" -H "Authorization: Bearer $TOKEN" | jq -e '.[0].remainingCredits==6' >/dev/null && echo "✅ Ivan remainingCredits=6 after reconciliation"
```

## Ivan trains 7 more times (exhaust credits, last one should be UNPAID if credits run out)
Add 6 trainings (all PAID, subscription exhausted)
```bash
export IVAN_D3="2025-12-24"
for i in $(seq 1 6); do
  TIME=$(printf "18:%02d" $((30+i)))
  TRAINER=$T_KRASI
  if [ $((i % 2)) -eq 0 ]; then TRAINER=$T_VELCHO; fi

  curl -s -X POST "$API/attendance" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"traineeId\":\"$TR_IVAN\",\"trainerId\":\"$TRAINER\",\"locationId\":\"$LOC_1\",\"trainedDate\":\"$IVAN_D3\",\"trainedTime\":\"$TIME\"}" >/dev/null
done
echo "✅ Ivan added 6 trainings on $IVAN_D3"
```

Verify subscription exhausted (remainingCredits 0, status EXHAUSTED):
```bash
curl -s "$API/trainees/$TR_IVAN/subscriptions" -H "Authorization: Bearer $TOKEN" | jq -e '
  .[0].remainingCredits==0 and .[0].status=="EXHAUSTED"
' >/dev/null && echo "✅ Ivan subscription exhausted"
```

Add one more training after exhaustion → should be UNPAID:
```bash
export IVAN_D4="2025-12-25"
curl -s -X POST "$API/attendance" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"traineeId\":\"$TR_IVAN\",\"trainerId\":\"$T_VITO\",\"locationId\":\"$LOC_1\",\"trainedDate\":\"$IVAN_D4\",\"trainedTime\":\"18:30\"}" | jq

curl -s "$API/attendance?date=$IVAN_D4&traineeId=$TR_IVAN" -H "Authorization: Bearer $TOKEN" | jq -e '
  (length==1) and (.[0].paymentStatus=="UNPAID")
' >/dev/null && echo "✅ Ivan post-exhaustion attendance is UNPAID"
```

## Verify sessions + overview endpoints
Sessions:
```bash
curl -s "$API/attendance/sessions?date=$S1_DATE" -H "Authorization: Bearer $TOKEN" | jq
curl -s "$API/attendance/sessions?date=$S5_DATE&trainerId=$T_VITO" -H "Authorization: Bearer $TOKEN" | jq
curl -s "$API/attendance/sessions?date=$IVAN_D3&bucketMinutes=90" -H "Authorization: Bearer $TOKEN" | jq
```

Overview:
```bash
curl -s "$API/trainees/$TR_ANTON/overview" -H "Authorization: Bearer $TOKEN" | jq
curl -s "$API/trainees/$TR_ANI/overview"   -H "Authorization: Bearer $TOKEN" | jq
curl -s "$API/trainees/$TR_ADI/overview"   -H "Authorization: Bearer $TOKEN" | jq
curl -s "$API/trainees/$TR_DIDO/overview"  -H "Authorization: Bearer $TOKEN" | jq
curl -s "$API/trainees/$TR_IVAN/overview"  -H "Authorization: Bearer $TOKEN" | jq
```

## Generate settlement (December)
```bash
export SETTLEMENT_DEC=$(curl -s -X POST "$API/settlements" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"periodStart\":\"$DEC_FROM\",\"periodEnd\":\"$DEC_TO\"}" | jq)

echo "$SETTLEMENT_DEC" | jq
```

Assertions:

1 - TIME not reportable should be > 0 (Anton has 5 TIME trainings in Dec, TIME ends in Jan)
```bash
echo "$SETTLEMENT_DEC" | jq -e '.info.notReportableTimeAttendance >= 1' >/dev/null \
  && echo "✅ Settlement shows TIME not-reportable attendance"
```

2 - There should be lines for trainers (at least Velcho/Vito/Krasi) and at least one has amount > 0
```bash
echo "$SETTLEMENT_DEC" | jq -e '
  (.lines | length >= 1) and ( (.lines | map(.amountCents) | max) > 0 )
' >/dev/null && echo "✅ Settlement has trainer payouts"
```

3 - (Optional) Unpaid attendance should be > 0 because Ivan has one UNPAID after exhaustion
```bash
echo "$SETTLEMENT_DEC" | jq -e '.info.unpaidAttendance >= 1' >/dev/null \
  && echo "✅ Settlement includes unpaid attendance"
```

## List settlements + allocations + finalize
List:
```bash
curl -s "$API/settlements" -H "Authorization: Bearer $TOKEN" | jq
export SETTLEMENT_ID=$(curl -s "$API/settlements" -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')
echo "SETTLEMENT_ID=$SETTLEMENT_ID"
```

Allocations:
```bash
curl -s "$API/settlements/$SETTLEMENT_ID/allocations?limit=200" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Filter allocations by trainer:
```bash
curl -s "$API/settlements/$SETTLEMENT_ID/allocations?limit=200&trainerId=$T_VITO" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Finalize:
```bash
curl -s -X POST "$API/settlements/$SETTLEMENT_ID/finalize" \
  -H "Authorization: Bearer $TOKEN" | jq
```
