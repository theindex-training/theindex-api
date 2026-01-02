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

  @Column({ type: 'int' })
  unpaidAttendanceCount!: number;

  // optional breakdown for UI later
  @Column({ type: 'jsonb', nullable: true })
  details!: any | null;
}
