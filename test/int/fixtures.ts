import { TestingModule } from '@nestjs/testing';
import { DataSource, DeepPartial } from 'typeorm';
import { AttendanceEntity } from '../../src/attendance/attendance.entity';
import { AttendanceService } from '../../src/attendance/attendance.service';
import { CashRegisterKvEntity } from '../../src/cash-register/cash-register-kv.entity';
import { CashRegisterTransactionEntity } from '../../src/cash-register/cash-register-transaction.entity';
import { CashRegisterService } from '../../src/cash-register/cash-register.service';
import { AttendancePaymentStatus } from '../../src/common/enums/attendance-payment-status.enum';
import { PlanType } from '../../src/common/enums/plan-type.enum';
import { SubscriptionStatus } from '../../src/common/enums/subscription-status.enum';
import { GymLocationEntity } from '../../src/gym-locations/gym-location.entity';
import { GymSubscriptionEntity } from '../../src/gym-subscriptions/gym-subscription.entity';
import { PlanEntity } from '../../src/plans/plan.entity';
import { SettlementAllocationEntity } from '../../src/settlements/settlement-allocation.entity';
import { SettlementLineEntity } from '../../src/settlements/settlement-line.entity';
import { SettlementEntity } from '../../src/settlements/settlement.entity';
import { SettlementsService } from '../../src/settlements/settlements.service';
import { SubscriptionResolverService } from '../../src/subscriptions/subscription-resolver.service';
import { SubscriptionEntity } from '../../src/subscriptions/subscription.entity';
import { SubscriptionsService } from '../../src/subscriptions/subscriptions.service';
import { TraineeProfileEntity } from '../../src/trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../../src/trainer-profiles/trainer-profile.entity';

/**
 * INF-05: data builders. Subscriptions, attendance and cash movements go
 * through the real services so setup follows the real rules. Direct inserts
 * (`insert*`) are only for states the services cannot produce.
 */
export class Fixtures {
  readonly moduleRef: TestingModule;
  readonly ds: DataSource;
  readonly attendance: AttendanceService;
  readonly cashRegister: CashRegisterService;
  readonly settlements: SettlementsService;
  readonly subscriptions: SubscriptionsService;
  readonly resolver: SubscriptionResolverService;

  constructor(moduleRef: TestingModule) {
    this.moduleRef = moduleRef;
    this.ds = moduleRef.get(DataSource);
    this.attendance = moduleRef.get(AttendanceService);
    this.cashRegister = moduleRef.get(CashRegisterService);
    this.settlements = moduleRef.get(SettlementsService);
    this.subscriptions = moduleRef.get(SubscriptionsService);
    this.resolver = moduleRef.get(SubscriptionResolverService);
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

  location(name = 'Main', extra: DeepPartial<GymLocationEntity> = {}) {
    return this.ds
      .getRepository(GymLocationEntity)
      .save({ name, isActive: true, ...extra });
  }

  gymSubscription(name = 'MultiSport') {
    return this.ds
      .getRepository(GymSubscriptionEntity)
      .save({ name, isActive: true });
  }

  punchPlan(
    credits: number,
    priceCents: number,
    extra: DeepPartial<PlanEntity> = {},
  ) {
    return this.ds.getRepository(PlanEntity).save({
      type: PlanType.PUNCH,
      title: `Punch ${credits}`,
      priceCents,
      credits,
      durationDays: null,
      isActive: true,
      ...extra,
    });
  }

  timePlan(
    durationDays: number,
    priceCents: number,
    extra: DeepPartial<PlanEntity> = {},
  ) {
    return this.ds.getRepository(PlanEntity).save({
      type: PlanType.TIME,
      title: `Time ${durationDays}d`,
      priceCents,
      credits: null,
      durationDays,
      isActive: true,
      ...extra,
    });
  }

  // ---- through real services ----

  buy(
    traineeId: string,
    planId: string,
    opts: { paidCents?: number; startsAt?: string } = {},
  ) {
    return this.subscriptions.createForTrainee(traineeId, { planId, ...opts });
  }

  /** Records attendance through AttendanceService.create. */
  async attend(
    traineeId: string,
    trainerId: string,
    locationId: string,
    trainedAt: string,
  ) {
    return this.attendance.create({
      traineeId,
      trainerId,
      locationId,
      trainedAt,
    });
  }

  cashIn(amountCents: number) {
    return this.cashRegister.createManualTransaction({
      direction: 'IN',
      amountCents,
    });
  }

  cashOut(amountCents: number) {
    return this.cashRegister.createManualTransaction({
      direction: 'OUT',
      amountCents,
    });
  }

  // ---- direct inserts for states the API cannot produce ----

  insertSubscription(row: DeepPartial<SubscriptionEntity>) {
    return this.ds.getRepository(SubscriptionEntity).save({
      paidCents: 0,
      status: SubscriptionStatus.ACTIVE,
      endsAt: null,
      initialCredits: null,
      remainingCredits: null,
      ...row,
    });
  }

  insertAttendance(row: DeepPartial<AttendanceEntity>) {
    return this.ds.getRepository(AttendanceEntity).save({
      paymentStatus: AttendancePaymentStatus.UNPAID,
      subscriptionId: null,
      gymSubscriptionId: null,
      ...row,
    });
  }

  // ---- reads ----

  sub(id: string) {
    return this.ds.getRepository(SubscriptionEntity).findOneByOrFail({ id });
  }

  att(id: string) {
    return this.ds.getRepository(AttendanceEntity).findOneByOrFail({ id });
  }

  attendanceRows() {
    return this.ds.getRepository(AttendanceEntity).find();
  }

  subscriptionRows() {
    return this.ds.getRepository(SubscriptionEntity).find();
  }

  async balance(): Promise<number> {
    const row = await this.ds
      .getRepository(CashRegisterKvEntity)
      .findOneBy({ key: 'cash_register_balance_cents' });
    return row ? Number(row.value) : 0;
  }

  cashTxs() {
    return this.ds
      .getRepository(CashRegisterTransactionEntity)
      .find({ order: { createdAt: 'ASC' } });
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

  /** attendanceId -> valueCents for a settlement. */
  async allocationValues(settlementId: string): Promise<Map<string, number>> {
    const rows = await this.allocationsOf(settlementId);
    return new Map(rows.map((r) => [r.attendanceId, r.valueCents]));
  }
}

/** Awaits a promise expected to reject and returns the error. */
export async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof Error) return err;
    throw new Error(`Rejected with a non-Error value: ${String(err)}`, {
      cause: err,
    });
  }
  throw new Error('Expected promise to reject, but it resolved');
}
