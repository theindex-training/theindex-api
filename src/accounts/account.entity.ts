import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';

export type AccountRegistration = {
  name: string;
  phone: string;
  gymSubscriptionId: string | null;
  preferredGymId: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
};

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

  @Column({ type: 'enum', enum: AccountStatus, default: AccountStatus.ACTIVE })
  status!: AccountStatus;

  @Column({ type: 'boolean', default: false })
  hasUpdatedInitialPassword!: boolean;

  @Index({ unique: true })
  @Column({ type: 'uuid', nullable: true })
  trainerProfileId!: string | null;

  @OneToOne(() => TrainerProfileEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'trainerProfileId' })
  trainerProfile?: TrainerProfileEntity | null;

  @Index({ unique: true })
  @Column({ type: 'uuid', nullable: true })
  traineeProfileId!: string | null;

  @OneToOne(() => TraineeProfileEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'traineeProfileId' })
  traineeProfile?: TraineeProfileEntity | null;

  /**
   * What the person entered when they created the account themselves (`POST /api/auth/register`),
   * kept as entered: an admin reads it to connect the account to a profile and decides what the
   * profile stores. Null for accounts an admin created.
   */
  @Column({ type: 'jsonb', nullable: true })
  registration!: AccountRegistration | null;

  /** When the person agreed to the use of their personal data and to receiving emails. */
  @Column({ type: 'timestamptz', nullable: true })
  consentAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
