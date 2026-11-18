import {
  Check,
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
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { BenchmarkKind } from './enums/benchmark-kind.enum';
import { BenchmarkScoreType } from './enums/benchmark-score-type.enum';

export const BENCHMARK_NAME_INDEX = 'UQ_benchmarks_name_key';

/**
 * A benchmark workout (Fran, Murph, Cindy...) or a heavy lift (Back Squat 1RM) people log their
 * results on. Unrelated to the workouts of the day: Fran can be a day's workout too, but results
 * are logged here. The exercises are the movements it uses, in order, so beginners can look them
 * up; a heavy lift has exactly one.
 */
@Entity('benchmarks')
@Index(BENCHMARK_NAME_INDEX, ['nameKey'], { unique: true })
export class BenchmarkEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: BenchmarkKind;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  /** benchmarkNameKey(name): unique, so "fran" can't be added next to "Fran". Internal. */
  @Column({ type: 'varchar', length: 80, select: false })
  nameKey!: string;

  /** Always LOAD for a heavy lift; never LOAD for a benchmark. */
  @Column({ type: 'varchar', length: 20 })
  scoreType!: BenchmarkScoreType;

  /** TIME only: whoever doesn't finish within it logs the reps done. */
  @Column({ type: 'int', nullable: true })
  timeCapSeconds!: number | null;

  /** The workout as people read it (plain text, line breaks kept). Optional for heavy lifts. */
  @Column({ type: 'text', default: '' })
  description!: string;

  @OneToMany(() => BenchmarkExerciseEntity, (link) => link.benchmark)
  exercises!: BenchmarkExerciseEntity[];

  @OneToMany(() => BenchmarkResultEntity, (result) => result.benchmark)
  results?: BenchmarkResultEntity[];

  /** Inactive ones are hidden from the records pages and take no new results; results stay. */
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

/** An exercise a benchmark uses, at its place in the list. */
@Entity('benchmark_exercises')
@Unique('UQ_benchmark_exercises_benchmark_exercise', [
  'benchmarkId',
  'exerciseId',
])
export class BenchmarkExerciseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  benchmarkId!: string;

  @ManyToOne(() => BenchmarkEntity, (benchmark) => benchmark.exercises, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'benchmarkId' })
  benchmark?: BenchmarkEntity;

  @Index()
  @Column({ type: 'uuid' })
  exerciseId!: string;

  @ManyToOne(() => ExerciseEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'exerciseId' })
  exercise?: ExerciseEntity;

  /** Order in the benchmark, from 0. */
  @Column({ type: 'int' })
  position!: number;
}

/** numeric comes back from pg as a string. */
const decimal = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

/**
 * One logged result: whose (a trainee's or a trainer's profile), on which day, Rx or scaled, the
 * score (only the fields of the benchmark's score type are set: `benchmark-score.ts`) and an
 * optional note. Nobody validates results. Deleting the profile deletes its results.
 */
@Entity('benchmark_results')
@Check(
  'CHK_benchmark_results_one_owner',
  `("traineeProfileId" IS NULL) <> ("trainerProfileId" IS NULL)`,
)
@Index(['benchmarkId', 'scaled'])
export class BenchmarkResultEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  benchmarkId!: string;

  @ManyToOne(() => BenchmarkEntity, (benchmark) => benchmark.results, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'benchmarkId' })
  benchmark?: BenchmarkEntity;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  traineeProfileId!: string | null;

  @ManyToOne(() => TraineeProfileEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'traineeProfileId' })
  traineeProfile?: TraineeProfileEntity | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  trainerProfileId!: string | null;

  @ManyToOne(() => TrainerProfileEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trainerProfileId' })
  trainerProfile?: TrainerProfileEntity | null;

  /** The gym-local day it was done (Europe/Sofia), 'YYYY-MM-DD'. Never in the future. */
  @Column({ type: 'date' })
  performedOn!: string;

  /** A scaled version (lighter, fewer reps, another movement...): the note says how. */
  @Column({ type: 'boolean', default: false })
  scaled!: boolean;

  @Column({ type: 'int', nullable: true })
  timeSeconds!: number | null;

  @Column({ type: 'boolean', default: false })
  capped!: boolean;

  @Column({ type: 'int', nullable: true })
  rounds!: number | null;

  @Column({ type: 'int', nullable: true })
  reps!: number | null;

  /** kg, in steps of 0.5. */
  @Column({
    type: 'numeric',
    precision: 6,
    scale: 1,
    nullable: true,
    transformer: decimal,
  })
  loadKg!: number | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  /** When it was logged (the day it was done is `performedOn`). */
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
