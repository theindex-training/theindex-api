import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { SettlementEntity } from './settlement.entity';

export interface SettlementLineDetails {
  punchCents: number;
  timeCents: number;
  /** Absent on lines finalized before carried-over trainings existed. */
  earlierPeriodsCents?: number;
  earlierPeriodsCount?: number;
}

@Entity('settlement_lines')
@Index(['settlementId', 'trainerId'], { unique: true })
export class SettlementLineEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  settlementId!: string;

  @ManyToOne(() => SettlementEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'settlementId' })
  settlement!: SettlementEntity;

  @Column({ type: 'uuid' })
  trainerId!: string;

  @ManyToOne(() => TrainerProfileEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trainerId' })
  trainer!: TrainerProfileEntity;

  @Column({ type: 'int' })
  amountCents!: number;

  @Column({ type: 'int' })
  attendanceCount!: number;

  /** The trainer's trainings of the period still waiting when it was finalized. */
  @Column({ type: 'int' })
  unpaidAttendanceCount!: number;

  @Column({ type: 'jsonb', nullable: true })
  details!: SettlementLineDetails | null;
}
