import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AccountEntity } from '../accounts/account.entity';
import { GymLocationEntity } from '../gym-locations/gym-location.entity';

@Entity('trainer_profiles')
export class TrainerProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'uuid', nullable: true })
  accountId!: string | null;

  @OneToOne(() => AccountEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'accountId' })
  account?: AccountEntity | null;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  nickname!: string | null;

  /** The gym the trainer mainly leads trainings in: the default gym of their pages. */
  @Column({ type: 'uuid', nullable: true })
  primaryGymId!: string | null;

  @ManyToOne(() => GymLocationEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'primaryGymId' })
  primaryGym?: GymLocationEntity | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  /** Social network profiles (a handle or a link, as typed); null when not given. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  instagram!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  facebook!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  tiktok!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
