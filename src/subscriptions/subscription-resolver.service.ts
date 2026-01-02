import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, Repository } from 'typeorm';
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
}
