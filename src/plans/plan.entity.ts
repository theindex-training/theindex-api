import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PlanType } from '../common/enums/plan-type.enum';

@Entity('plans')
export class PlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: PlanType })
  type!: PlanType;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'int' })
  priceCents!: number;

  // PUNCH
  @Column({ type: 'int', nullable: true })
  credits!: number | null;

  // TIME
  @Column({ type: 'int', nullable: true })
  durationDays!: number | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
