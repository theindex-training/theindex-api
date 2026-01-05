import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';

@Entity('accounts')
export class AccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', nullable: true })
  passwordHash!: string | null;

  @Column({ type: 'enum', enum: AccountRole })
  role!: AccountRole;

  @Column({ type: 'enum', enum: AccountStatus, default: AccountStatus.INVITED })
  status!: AccountStatus;

  @Index({ unique: true })
  @Column({ type: 'uuid', nullable: true })
  trainerProfileId!: string | null;

  @OneToOne(() => TrainerProfileEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'trainerProfileId' })
  trainerProfile?: TrainerProfileEntity | null;

  @Index({ unique: true })
  @Column({ type: 'uuid', nullable: true })
  traineeProfileId!: string | null;

  @OneToOne(() => TraineeProfileEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'traineeProfileId' })
  traineeProfile?: TraineeProfileEntity | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
