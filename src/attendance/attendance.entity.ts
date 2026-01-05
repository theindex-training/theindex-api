import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { GymLocationEntity } from '../gym-locations/gym-location.entity';
import { SubscriptionEntity } from '../subscriptions/subscription.entity';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';

@Entity('attendance')
@Index(['trainedAt'])
@Index(['traineeId', 'trainedAt'])
export class AttendanceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  traineeId!: string;

  @ManyToOne(() => TraineeProfileEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'traineeId' })
  trainee!: TraineeProfileEntity;

  @Column({ type: 'uuid' })
  trainerId!: string;

  @ManyToOne(() => TrainerProfileEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trainerId' })
  trainer!: TrainerProfileEntity;

  @Column({ type: 'uuid' })
  locationId!: string;

  @ManyToOne(() => GymLocationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'locationId' })
  location!: GymLocationEntity | null;

  @Column({ type: 'timestamptz' })
  trainedAt!: Date;

  @Column({ type: 'uuid', nullable: true })
  subscriptionId!: string | null;

  @ManyToOne(() => SubscriptionEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subscriptionId' })
  subscription?: SubscriptionEntity | null;

  @Column({ type: 'enum', enum: AttendancePaymentStatus })
  paymentStatus!: AttendancePaymentStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
