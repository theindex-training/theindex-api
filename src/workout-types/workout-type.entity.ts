import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ScoreType, WorkoutTypeCode } from './workout-type.enums';

export const WORKOUT_TYPE_NAME_INDEX = 'UQ_workout_types_name_key';
export const WORKOUT_TYPE_CODE_INDEX = 'UQ_workout_types_code';

/** Names are unique ignoring case and surrounding spaces. */
export function workoutTypeNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * A kind of workout: For time, AMRAP, EMOM, Tabata, For load, or one the trainers describe
 * themselves. `scoreType` is the score a workout of this type starts with (a workout part can
 * choose another, e.g. an EMOM scored by total reps).
 */
@Entity('workout_types')
@Index(WORKOUT_TYPE_NAME_INDEX, ['nameKey'], { unique: true })
@Index(WORKOUT_TYPE_CODE_INDEX, ['code'], { unique: true })
export class WorkoutTypeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 60 })
  name!: string;

  /** workoutTypeNameKey(name). Internal: not selected, so it never appears in responses. */
  @Column({ type: 'varchar', length: 60, select: false })
  nameKey!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  /** Set on the built-in types only; those can't be deleted. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  code!: WorkoutTypeCode | null;

  @Column({ type: 'enum', enum: ScoreType, default: ScoreType.NONE })
  scoreType!: ScoreType;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
