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
import { ExerciseEntity } from '../exercises/exercise.entity';
import { MediaEntity } from '../media/media.entity';

/**
 * A workout of the day (WOD). A day may have several (regular groups, competitors, skills...);
 * nothing tells them apart but their name. The summary is the workout as people read it; the
 * exercises are the movements it uses, in order, so trainees can look them up.
 */
@Entity('workouts')
export class WorkoutEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The gym-local day (Europe/Sofia) the workout is for, 'YYYY-MM-DD'. */
  @Index()
  @Column({ type: 'date' })
  date!: string;

  /** A name when the workout has one ("Helen", "Competitors"). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  title!: string | null;

  /** Plain text; line breaks are kept and matter. Required by the API. */
  @Column({ type: 'text', default: '' })
  summary!: string;

  @OneToMany(() => WorkoutExerciseEntity, (link) => link.workout)
  exercises!: WorkoutExerciseEntity[];

  /**
   * The lesson-plan PDF the workout was imported from (a `WORKOUT_PDF` media item), kept for
   * reference: the workout's fields may have been edited since. Several workouts may share one.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  sourcePdfId!: string | null;

  @ManyToOne(() => MediaEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sourcePdfId' })
  sourcePdf?: MediaEntity | null;

  @Column({ type: 'uuid', nullable: true })
  createdByAccountId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

/** An exercise a workout uses, at its place in the list. */
@Entity('workout_exercises')
@Unique('UQ_workout_exercises_workout_exercise', ['workoutId', 'exerciseId'])
export class WorkoutExerciseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  workoutId!: string;

  @ManyToOne(() => WorkoutEntity, (workout) => workout.exercises, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'workoutId' })
  workout?: WorkoutEntity;

  @Index()
  @Column({ type: 'uuid' })
  exerciseId!: string;

  @ManyToOne(() => ExerciseEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'exerciseId' })
  exercise?: ExerciseEntity;

  /** Order in the workout, from 0. */
  @Column({ type: 'int' })
  position!: number;
}
