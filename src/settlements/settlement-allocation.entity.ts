import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AttendanceEntity } from '../attendance/attendance.entity';
import { PlanType } from '../common/enums/plan-type.enum';
import { SubscriptionEntity } from '../subscriptions/subscription.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { AllocationReason } from './enums/allocation-reason.enum';
import { SettlementEntity } from './settlement.entity';

@Entity('settlement_allocations')
@Index(['settlementId', 'attendanceId'], { unique: true })
export class SettlementAllocationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  settlementId!: string;

  @ManyToOne(() => SettlementEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'settlementId' })
  settlement!: SettlementEntity;

  @Column({ type: 'uuid' })
  attendanceId!: string;

  @ManyToOne(() => AttendanceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'attendanceId' })
  attendance!: AttendanceEntity;

  @Column({ type: 'uuid' })
  trainerId!: string;

  @ManyToOne(() => TrainerProfileEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trainerId' })
  trainer!: TrainerProfileEntity;

  @Column({ type: 'uuid', nullable: true })
  subscriptionId!: string | null;

  @ManyToOne(() => SubscriptionEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subscriptionId' })
  subscription?: SubscriptionEntity | null;

  @Column({ type: 'enum', enum: PlanType, nullable: true })
  subscriptionType!: PlanType | null;

  @Column({ type: 'int' })
  valueCents!: number;

  @Column({ type: 'enum', enum: AllocationReason })
  reason!: AllocationReason;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
