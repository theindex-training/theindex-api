import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, Repository } from 'typeorm';
import { AttendanceEntity } from '../attendance/attendance.entity';
import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { PlanType } from '../common/enums/plan-type.enum';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { SubscriptionEntity } from './subscription.entity';

@Injectable()
export class SubscriptionResolverService {
  constructor(
    @InjectRepository(SubscriptionEntity)
    private readonly subsRepo: Repository<SubscriptionEntity>,
  ) {}

  async resolveForAttendance(
    traineeId: string,
    trainedAt: Date,
    manager?: EntityManager,
  ): Promise<SubscriptionEntity | null> {
    const repo: Repository<SubscriptionEntity> = manager
      ? manager.getRepository(SubscriptionEntity)
      : this.subsRepo;

    // Eligible:
    // - punch: ACTIVE and remainingCredits > 0
    // - time : ACTIVE and startsAt <= trainedAt < endsAt
    const qb = repo.createQueryBuilder('s');

    qb.where('s.traineeId = :traineeId', { traineeId })
      .andWhere('s.status = :status', { status: SubscriptionStatus.ACTIVE })
      .andWhere(
        new Brackets((b) => {
          b.where(
            `(s.type = :punch AND s.remainingCredits IS NOT NULL AND s.remainingCredits > 0)`,
            { punch: PlanType.PUNCH },
          ).orWhere(
            `(s.type = :time AND s.endsAt IS NOT NULL AND s.startsAt <= :trainedAt AND :trainedAt < s.endsAt)`,
            { time: PlanType.TIME, trainedAt },
          );
        }),
      )
      .orderBy('s.startsAt', 'ASC')
      .addOrderBy('s.createdAt', 'ASC')
      .limit(1);

    return qb.getOne();
  }

  /**
   * Pays the trainee's UNPAID attendance, oldest first, from their ACTIVE
   * subscriptions, each training by the rule that records attendance
   * (`resolveForAttendance`): a PUNCH card with credits left pays any
   * training, a TIME pass only those inside its period. Runs after a delete
   * frees trainings or gives a credit back, so a trainee with a card never
   * keeps unpaid trainings that card could pay. (Buying a subscription has
   * its own reconciliation in `SubscriptionsService`.) Returns how many were
   * paid. Call it inside the caller's transaction.
   */
  async payUnpaidAttendance(
    traineeId: string,
    manager: EntityManager,
  ): Promise<number> {
    const attendanceRepo = manager.getRepository(AttendanceEntity);
    const subscriptionRepo = manager.getRepository(SubscriptionEntity);

    const hasActive = await subscriptionRepo.exists({
      where: { traineeId, status: SubscriptionStatus.ACTIVE },
    });
    if (!hasActive) return 0;

    const unpaid = await attendanceRepo.find({
      where: { traineeId, paymentStatus: AttendancePaymentStatus.UNPAID },
      order: { trainedAt: 'ASC', createdAt: 'ASC' },
    });

    let paid = 0;
    for (const attendance of unpaid) {
      const subscription = await this.resolveForAttendance(
        traineeId,
        attendance.trainedAt,
        manager,
      );
      if (!subscription) continue;

      if (subscription.type === PlanType.PUNCH) {
        const locked = await subscriptionRepo
          .createQueryBuilder('s')
          .setLock('pessimistic_write')
          .where('s.id = :id', { id: subscription.id })
          .getOne();
        if (!locked?.remainingCredits || locked.remainingCredits <= 0) continue;

        locked.remainingCredits -= 1;
        if (locked.remainingCredits === 0) {
          locked.status = SubscriptionStatus.EXHAUSTED;
        }
        await subscriptionRepo.save(locked);
      }

      await attendanceRepo.update(attendance.id, {
        paymentStatus: AttendancePaymentStatus.PAID,
        subscriptionId: subscription.id,
      });
      paid += 1;
    }
    return paid;
  }
}
