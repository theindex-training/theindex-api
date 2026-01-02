import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PlanType } from '../common/enums/plan-type.enum';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { PlanEntity } from '../plans/plan.entity';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';

@Entity('subscriptions')
@Index(['traineeId', 'startsAt'])
export class SubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  traineeId!: string;

  @ManyToOne(() => TraineeProfileEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'traineeId' })
  trainee!: TraineeProfileEntity;

  @Column({ type: 'uuid' })
  planId!: string;

  @ManyToOne(() => PlanEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'planId' })
  plan!: PlanEntity;

  @Column({ type: 'enum', enum: PlanType })
  type!: PlanType;

  @Column({ type: 'int' })
  paidCents!: number;

  // TODO needs to be optional because PUNCH type does not need it
  @Column({ type: 'timestamptz' })
  startsAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endsAt!: Date | null;

  // PUNCH
  @Column({ type: 'int', nullable: true })
  initialCredits!: number | null;

  @Column({ type: 'int', nullable: true })
  remainingCredits!: number | null;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.ACTIVE,
  })
  status!: SubscriptionStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
