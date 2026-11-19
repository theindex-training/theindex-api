import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ProfilePhotosService } from '../profile-photos/profile-photos.service';
import { Repository } from 'typeorm';
import { AttendanceEntity } from '../attendance/attendance.entity';
import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import {
  buildSubscriptionRenewals,
  RenewalAttendanceStats,
  RenewalSections,
  SubscriptionRenewals,
} from './subscription-renewals';
import { SubscriptionEntity } from './subscription.entity';

/**
 * Who needs to renew: every active trainee with a subscription, split into
 * PUNCH and TIME and into exhausted / still active (see
 * `subscription-renewals.ts` for the rules and the order).
 */
type WithPhoto<T> = T & { photoUrl: string | null };
type SectionsWithPhotos = {
  [K in keyof RenewalSections]: WithPhoto<RenewalSections[K][number]>[];
};
export type SubscriptionRenewalsWithPhotos = {
  [K in keyof SubscriptionRenewals]: SectionsWithPhotos;
};

@Injectable()
export class SubscriptionRenewalsService {
  constructor(
    @InjectRepository(TraineeProfileEntity)
    private readonly traineeRepo: Repository<TraineeProfileEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subRepo: Repository<SubscriptionEntity>,
    @InjectRepository(AttendanceEntity)
    private readonly attRepo: Repository<AttendanceEntity>,
    private readonly photos: ProfilePhotosService,
  ) {}

  /**
   * The renewals page (`subscription-renewals.ts`), each row with the trainee's profile photo
   * thumbnail (`photoUrl`, null without one).
   */
  async overview(): Promise<SubscriptionRenewalsWithPhotos> {
    const now = new Date();

    const [trainees, subscriptions, attendanceRows] = await Promise.all([
      this.traineeRepo.find({
        select: { id: true, name: true, nickname: true },
        where: { isActive: true },
      }),
      this.subRepo
        .createQueryBuilder('s')
        .innerJoin('s.trainee', 't', 't.isActive = true')
        .innerJoin('s.plan', 'p')
        .select([
          's.traineeId AS "traineeId"',
          's.type AS "type"',
          's.status AS "status"',
          'p.title AS "planTitle"',
          's.startsAt AS "startsAt"',
          's.endsAt AS "endsAt"',
          's.remainingCredits AS "remainingCredits"',
          's.createdAt AS "createdAt"',
        ])
        .getRawMany<{
          traineeId: string;
          type: SubscriptionEntity['type'];
          status: SubscriptionEntity['status'];
          planTitle: string;
          startsAt: Date;
          endsAt: Date | null;
          remainingCredits: number | null;
          createdAt: Date;
        }>(),
      this.attRepo
        .createQueryBuilder('a')
        .innerJoin('a.trainee', 't', 't.isActive = true')
        .select('a.traineeId', 'traineeId')
        .addSelect(
          `COUNT(*) FILTER (WHERE a.paymentStatus = :unpaid)`,
          'unpaidTrainings',
        )
        .addSelect('MAX(a.trainedAt)', 'lastTrainedAt')
        .setParameter('unpaid', AttendancePaymentStatus.UNPAID)
        .groupBy('a.traineeId')
        .getRawMany<{
          traineeId: string;
          unpaidTrainings: string;
          lastTrainedAt: Date | null;
        }>(),
    ]);

    const attendance = new Map<string, RenewalAttendanceStats>(
      attendanceRows.map((row) => [
        row.traineeId,
        {
          unpaidTrainings: Number(row.unpaidTrainings),
          lastTrainedAt: row.lastTrainedAt,
        },
      ]),
    );

    const renewals = buildSubscriptionRenewals(
      trainees,
      subscriptions,
      attendance,
      now,
    );
    const photos = await this.photos.thumbnails({
      traineeProfileIds: trainees.map((t) => t.id),
      trainerProfileIds: [],
    });
    const withPhotos = <T extends { traineeId: string }>(rows: T[]) =>
      rows.map((row) => ({
        ...row,
        photoUrl: photos.trainee.get(row.traineeId) ?? null,
      }));
    return {
      punch: {
        exhausted: withPhotos(renewals.punch.exhausted),
        active: withPhotos(renewals.punch.active),
      },
      time: {
        exhausted: withPhotos(renewals.time.exhausted),
        active: withPhotos(renewals.time.active),
      },
    };
  }
}
