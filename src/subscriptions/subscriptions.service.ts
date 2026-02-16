import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AttendanceEntity } from '../attendance/attendance.entity';
import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { PlanType } from '../common/enums/plan-type.enum';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { PlanEntity } from '../plans/plan.entity';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SubscriptionEntity } from './subscription.entity';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SubscriptionEntity)
    private readonly subRepo: Repository<SubscriptionEntity>,
    @InjectRepository(PlanEntity)
    private readonly planRepo: Repository<PlanEntity>,
    @InjectRepository(TraineeProfileEntity)
    private readonly traineeRepo: Repository<TraineeProfileEntity>,
    @InjectRepository(AttendanceEntity)
    private readonly attRepo: Repository<AttendanceEntity>,
  ) {}

  async createForTrainee(traineeId: string, dto: CreateSubscriptionDto) {
    return this.dataSource.transaction(async (manager) => {
      const trainee = await manager
        .getRepository(TraineeProfileEntity)
        .findOne({
          where: { id: traineeId, isActive: true },
        });
      if (!trainee)
        throw new BadRequestException('Trainee not found or inactive');

      const plan = await manager.getRepository(PlanEntity).findOne({
        where: { id: dto.planId, isActive: true },
      });
      if (!plan) throw new BadRequestException('Plan not found or inactive');

      if (
        plan.type === PlanType.PUNCH &&
        (!plan.credits || plan.credits <= 0)
      ) {
        throw new BadRequestException('Punch plan must have credits');
      }
      if (
        plan.type === PlanType.TIME &&
        (!plan.durationDays || plan.durationDays <= 0)
      ) {
        throw new BadRequestException('Time plan must have durationDays');
      }

      const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
      const paidCents = dto.paidCents ?? plan.priceCents;

      const subscriptionRepo = manager.getRepository(SubscriptionEntity);

      const subscription = subscriptionRepo.create({
        traineeId,
        planId: plan.id,
        type: plan.type,
        paidCents,
        startsAt,
        status: SubscriptionStatus.ACTIVE,
        endsAt:
          plan.type === PlanType.TIME
            ? new Date(
                startsAt.getTime() + plan.durationDays! * 24 * 60 * 60 * 1000,
              )
            : null,
        initialCredits: plan.type === PlanType.PUNCH ? plan.credits! : null,
        remainingCredits: plan.type === PlanType.PUNCH ? plan.credits! : null,
      });

      const saved = await subscriptionRepo.save(subscription);

      // ✅ Reconcile unpaid attendance immediately after purchase
      await this.reconcileUnpaidAttendance(manager, traineeId, saved);

      // Reload (credits might have changed)
      return subscriptionRepo.findOneOrFail({ where: { id: saved.id } });
    });
  }

  async exhaustPastEndTimeSubscriptions(): Promise<number> {
    const now = new Date();

    const result = await this.subRepo
      .createQueryBuilder()
      .update(SubscriptionEntity)
      .set({ status: SubscriptionStatus.EXHAUSTED })
      .where('type = :type', { type: PlanType.TIME })
      .andWhere('status = :status', { status: SubscriptionStatus.ACTIVE })
      .andWhere('endsAt IS NOT NULL')
      .andWhere('endsAt < :now', { now })
      .execute();

    return result.affected ?? 0;
  }
  async listForTrainee(traineeId: string) {
    return this.subRepo.find({
      where: { traineeId },
      order: { startsAt: 'DESC', createdAt: 'DESC' },
    });
  }

  async remove(id: string) {
    const subscription = await this.subRepo.findOne({ where: { id } });
    if (!subscription) throw new NotFoundException('Subscription not found');

    await this.subRepo.remove(subscription);
    return { deleted: true };
  }

  private async reconcileUnpaidAttendance(
    manager: EntityManager,
    traineeId: string,
    subscription: SubscriptionEntity,
  ): Promise<void> {
    const attendanceRepo = manager.getRepository(AttendanceEntity);
    const subscriptionRepo = manager.getRepository(SubscriptionEntity);

    // Get ALL unpaid attendances oldest first
    const unpaid = await this.attRepo.find({
      where: { traineeId, paymentStatus: AttendancePaymentStatus.UNPAID },
      order: { trainedAt: 'ASC', createdAt: 'ASC' },
    });

    if (unpaid.length === 0) return;

    if (subscription.type === PlanType.TIME) {
      // TIME: mark all unpaid as paid, attach to this subscription
      const ids = unpaid.map((a) => a.id);

      await attendanceRepo
        .createQueryBuilder()
        .update(AttendanceEntity)
        .set({
          paymentStatus: AttendancePaymentStatus.PAID,
          subscriptionId: subscription.id,
        })
        .whereInIds(ids)
        .execute();

      return;
    }

    // PUNCH: cover as many unpaid as credits allow
    // Lock the subscription row (safety)
    const locked = await subscriptionRepo
      .createQueryBuilder('s')
      .setLock('pessimistic_write')
      .where('s.id = :id', { id: subscription.id })
      .getOne();

    if (!locked) return;

    const available = locked.remainingCredits ?? 0;
    if (available <= 0) return;

    const toCover = unpaid.slice(0, available);
    const idsToCover = toCover.map((a) => a.id);

    // Update attendance rows: now PAID and linked to this subscription
    await attendanceRepo
      .createQueryBuilder()
      .update(AttendanceEntity)
      .set({
        paymentStatus: AttendancePaymentStatus.PAID,
        subscriptionId: locked.id,
      })
      .whereInIds(idsToCover)
      .execute();

    // Consume credits
    locked.remainingCredits = available - idsToCover.length;

    if (locked.remainingCredits === 0) {
      locked.status = SubscriptionStatus.EXHAUSTED;
    }

    await subscriptionRepo.save(locked);
  }
}
