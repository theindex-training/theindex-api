import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SettlementStatus } from './enums/settlement-status.enum';

@Entity('settlements')
export class SettlementEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // YYYY-MM-DD stored as date in postgres
  @Column({ type: 'date' })
  periodStart!: string;

  @Column({ type: 'date' })
  periodEnd!: string;

  /** When the report was created (automatically, once its period was over). */
  @Column({ type: 'timestamptz' })
  generatedAt!: Date;

  @Column({
    type: 'enum',
    enum: SettlementStatus,
    default: SettlementStatus.DRAFT,
  })
  status!: SettlementStatus;

  /** When it was finalized (and paid out); null while a draft. */
  @Column({ type: 'timestamptz', nullable: true })
  finalizedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
