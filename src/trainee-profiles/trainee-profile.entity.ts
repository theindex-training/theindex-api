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
import { GymLocationEntity } from '../gym-locations/gym-location.entity';
import { AccountEntity } from '../accounts/account.entity';
import { GymSubscriptionEntity } from '../gym-subscriptions/gym-subscription.entity';

@Entity('trainee_profiles')
export class TraineeProfileEntity {
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

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  @Column({ type: 'uuid', nullable: true })
  gymSubscriptionId!: string | null;

  @ManyToOne(() => GymSubscriptionEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'gymSubscriptionId' })
  gymSubscription?: GymSubscriptionEntity | null;

  /** The gym the trainee usually trains in: the default gym of their pages. */
  @Column({ type: 'uuid', nullable: true })
  preferredGymId!: string | null;

  @ManyToOne(() => GymLocationEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'preferredGymId' })
  preferredGym?: GymLocationEntity | null;

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
