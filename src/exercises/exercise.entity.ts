import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ExerciseMeasure, ExerciseModality } from './exercise.enums';

export const EXERCISE_NAME_INDEX = 'UQ_exercises_name_key';

/**
 * A movement workouts are built from: Back squat, Pull-up, Run, Plank...
 * Names are unique by `exerciseKey` (so "Pull-ups" can't be added next to "Pull-up"), and
 * `aliases` are other spellings the PDF import should recognise ("KB swing", "C2B pull-up").
 */
@Entity('exercises')
@Index(EXERCISE_NAME_INDEX, ['nameKey'], { unique: true })
export class ExerciseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  /** exerciseKey(name). Internal: not selected, so it never appears in responses. */
  @Column({ type: 'varchar', length: 120, select: false })
  nameKey!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  aliases!: string[];

  /** exerciseKey of every alias, for lookups. Internal. */
  @Column({ type: 'jsonb', default: () => "'[]'", select: false })
  aliasKeys!: string[];

  @Column({ type: 'enum', enum: ExerciseModality })
  modality!: ExerciseModality;

  /** What the workout form starts with when the movement is picked (Run: distance). */
  @Column({
    type: 'enum',
    enum: ExerciseMeasure,
    default: ExerciseMeasure.REPS,
  })
  defaultMeasure!: ExerciseMeasure;

  /** Inactive movements stay on old workouts but aren't offered for new ones. */
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
