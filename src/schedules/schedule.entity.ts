import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { GymLocationEntity } from '../gym-locations/gym-location.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { TrainingTimeEntity } from '../training-times/training-time.entity';
import { WorkoutEntity } from '../workouts/workout.entity';

/**
 * One training of a gym's usual week: a weekday, a training time and the trainer who leads it.
 * A gym's template is all its rows. Weeks are copied from it when created and are independent
 * after that: changing the template changes no week, and changing a week changes no template.
 */
@Entity('schedule_template_slots')
@Index(['gymId', 'weekday'])
export class ScheduleTemplateSlotEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  gymId!: string;

  @ManyToOne(() => GymLocationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gymId' })
  gym?: GymLocationEntity;

  /** ISO weekday: 1 = Monday ... 7 = Sunday. */
  @Column({ type: 'smallint' })
  weekday!: number;

  @Column({ type: 'uuid' })
  trainingTimeId!: string;

  @ManyToOne(() => TrainingTimeEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trainingTimeId' })
  trainingTime?: TrainingTimeEntity;

  @Column({ type: 'uuid' })
  trainerId!: string;

  @ManyToOne(() => TrainerProfileEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trainerId' })
  trainer?: TrainerProfileEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * A gym's real week, created on purpose from its template by a trainer or an admin. Booking a
 * training of the week opens once it exists. One per gym and week.
 */
@Entity('schedule_weeks')
@Unique('UQ_schedule_weeks_gym_week', ['gymId', 'weekStart'])
export class ScheduleWeekEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  gymId!: string;

  @ManyToOne(() => GymLocationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gymId' })
  gym?: GymLocationEntity;

  /** The Monday of the week, 'YYYY-MM-DD'. */
  @Column({ type: 'date' })
  weekStart!: string;

  @OneToMany(() => ScheduleSlotEntity, (slot) => slot.week)
  slots?: ScheduleSlotEntity[];

  @Column({ type: 'uuid', nullable: true })
  createdByAccountId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * One training of a real week: its day, training time and trainer, and optionally the workout
 * of that day it follows. Attendance and bookings will start from these.
 */
@Entity('schedule_slots')
@Index(['weekId', 'date'])
export class ScheduleSlotEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  weekId!: string;

  @ManyToOne(() => ScheduleWeekEntity, (week) => week.slots, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'weekId' })
  week?: ScheduleWeekEntity;

  /** The gym-local day, 'YYYY-MM-DD', inside the week. */
  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'uuid' })
  trainingTimeId!: string;

  @ManyToOne(() => TrainingTimeEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trainingTimeId' })
  trainingTime?: TrainingTimeEntity;

  @Column({ type: 'uuid' })
  trainerId!: string;

  @ManyToOne(() => TrainerProfileEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trainerId' })
  trainer?: TrainerProfileEntity;

  /** A workout of the same day, when the trainer says which one this training follows. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  workoutId!: string | null;

  @ManyToOne(() => WorkoutEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'workoutId' })
  workout?: WorkoutEntity | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
