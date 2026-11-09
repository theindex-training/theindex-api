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
import { ExerciseMeasure } from '../exercises/exercise.enums';
import { WorkoutTypeEntity } from '../workout-types/workout-type.entity';
import { ScoreType } from '../workout-types/workout-type.enums';
import { WorkoutLevel } from './workout.enums';

/** numeric columns come back from pg as strings. */
const numeric = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

/**
 * The workout of a day (WOD). Its content is structured, never free text, so results can be
 * compared later:
 *
 *   workout (date, title)
 *     part       what is done and how it is scored: type (For time, AMRAP...) and score type.
 *                Most days have one; a day with a skill piece or a strength piece has more.
 *       variant  one per level (RX always; Intermediate and Beginner when they differ) with the
 *                structure: rounds, rep scheme, durations, intervals.
 *         item   a movement with its amount (reps, metres, seconds or calories) and load.
 */
@Entity('workouts')
export class WorkoutEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The gym-local day (Europe/Sofia) the workout is for, 'YYYY-MM-DD'. */
  @Index()
  @Column({ type: 'date' })
  date!: string;

  /** A name when the workout has one ("Helen", "Fran"). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  title!: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdByAccountId!: string | null;

  @OneToMany(() => WorkoutPartEntity, (part) => part.workout)
  parts!: WorkoutPartEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('workout_parts')
export class WorkoutPartEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  workoutId!: string;

  @ManyToOne(() => WorkoutEntity, (workout) => workout.parts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'workoutId' })
  workout?: WorkoutEntity;

  /** Order within the workout, from 0. */
  @Column({ type: 'int' })
  position!: number;

  /** A heading when the part needs one ("Pre-workout build-up", "Strength"). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  title!: string | null;

  @Index()
  @Column({ type: 'uuid' })
  workoutTypeId!: string;

  @ManyToOne(() => WorkoutTypeEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'workoutTypeId' })
  workoutType?: WorkoutTypeEntity;

  /** How results of this part are recorded and ranked. Starts as the type's. */
  @Column({ type: 'enum', enum: ScoreType })
  scoreType!: ScoreType;

  @OneToMany(() => WorkoutVariantEntity, (variant) => variant.part)
  variants!: WorkoutVariantEntity[];
}

@Entity('workout_variants')
@Unique('UQ_workout_variants_part_level', ['partId', 'level'])
export class WorkoutVariantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  partId!: string;

  @ManyToOne(() => WorkoutPartEntity, (part) => part.variants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'partId' })
  part?: WorkoutPartEntity;

  @Column({ type: 'enum', enum: WorkoutLevel })
  level!: WorkoutLevel;

  /** "3 rounds for time", "5 sets", Tabata's 8. */
  @Column({ type: 'int', nullable: true })
  rounds!: number | null;

  /** Reps per round for items without their own amount: 21-15-9, 5-4-3-2-1, 5-3-1-5-3-1. */
  @Column({ type: 'jsonb', nullable: true })
  repScheme!: number[] | null;

  /** How long the part runs: AMRAP 12 -> 720, EMOM 20 -> 1200. */
  @Column({ type: 'int', nullable: true })
  durationSeconds!: number | null;

  @Column({ type: 'int', nullable: true })
  timeCapSeconds!: number | null;

  /** Length of one interval: EMOM -> 60, "every 2:00" -> 120. */
  @Column({ type: 'int', nullable: true })
  intervalSeconds!: number | null;

  /** Work in each round when it is timed (Tabata: 20). */
  @Column({ type: 'int', nullable: true })
  workSeconds!: number | null;

  /** Rest after each round (Tabata: 10; "rest 2:00 between rounds": 120). */
  @Column({ type: 'int', nullable: true })
  restSeconds!: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes!: string | null;

  @OneToMany(() => WorkoutItemEntity, (item) => item.variant)
  items!: WorkoutItemEntity[];
}

@Entity('workout_items')
export class WorkoutItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  variantId!: string;

  @ManyToOne(() => WorkoutVariantEntity, (variant) => variant.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'variantId' })
  variant?: WorkoutVariantEntity;

  /** Order within the variant, from 0. */
  @Column({ type: 'int' })
  position!: number;

  @Index()
  @Column({ type: 'uuid' })
  exerciseId!: string;

  @ManyToOne(() => ExerciseEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'exerciseId' })
  exercise?: ExerciseEntity;

  /** What `quantity` counts: reps, metres, seconds or calories. */
  @Column({ type: 'enum', enum: ExerciseMeasure })
  measure!: ExerciseMeasure;

  /**
   * The amount, in the measure's unit. Null when the reps come from the variant's rep scheme,
   * or when the item is a max effort with no set amount.
   */
  @Column({ type: 'int', nullable: true })
  quantity!: number | null;

  /** Upper end of a range ("10-15 skin-the-cats"). */
  @Column({ type: 'int', nullable: true })
  quantityMax!: number | null;

  /** The women's amount when it differs ("15/20-cal bike": 15). */
  @Column({ type: 'int', nullable: true })
  quantityFemale!: number | null;

  /**
   * As much as possible: with a TIME quantity, max reps/calories/metres in that time
   * (":40 row for calories"); without a quantity, a max set or hold.
   */
  @Column({ type: 'boolean', default: false })
  maxEffort!: boolean;

  @Column({
    type: 'numeric',
    precision: 6,
    scale: 2,
    nullable: true,
    transformer: numeric,
  })
  loadKg!: number | null;

  /** The women's load when it differs. */
  @Column({
    type: 'numeric',
    precision: 6,
    scale: 2,
    nullable: true,
    transformer: numeric,
  })
  loadFemaleKg!: number | null;

  /** Load as a percentage of the athlete's 1-rep max, instead of or beside kilograms. */
  @Column({ type: 'int', nullable: true })
  loadPercent!: number | null;

  /** In interval workouts, the interval of the rotation the item belongs to ("Min. 2": 2). */
  @Column({ type: 'int', nullable: true })
  slot!: number | null;

  /** A short standard or cue: "after each round", "per side", "to a 3-m target". */
  @Column({ type: 'varchar', length: 200, nullable: true })
  notes!: string | null;
}
