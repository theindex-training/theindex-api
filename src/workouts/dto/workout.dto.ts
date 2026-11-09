import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ExerciseMeasure } from '../../exercises/exercise.enums';
import { ScoreType } from '../../workout-types/workout-type.enums';
import { WorkoutLevel } from '../workout.enums';

export const WORKOUT_TITLE_MAX_LENGTH = 120;
export const WORKOUT_NOTES_MAX_LENGTH = 1000;
export const VARIANT_NOTES_MAX_LENGTH = 500;
export const ITEM_NOTES_MAX_LENGTH = 200;
export const MAX_PARTS = 10;
export const MAX_ITEMS = 40;
export const MAX_REP_SCHEME = 30;
/** Upper bound of every amount (reps, metres, seconds, calories): 100 km in metres. */
export const MAX_QUANTITY = 100_000;
export const MAX_LOAD_KG = 1000;
const MAX_SECONDS = 24 * 60 * 60;

const trim = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

/** An optional whole number of seconds, 1 or more; null clears it. */
function Seconds() {
  return applyDecorators(IsOptional(), IsInt(), Min(1), Max(MAX_SECONDS));
}

export class WorkoutItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  exerciseId!: string;

  @ApiProperty({ enum: ExerciseMeasure })
  @IsEnum(ExerciseMeasure)
  measure!: ExerciseMeasure;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Reps, metres, seconds or calories. Leave out when the reps come from the rep scheme or the item is a max effort.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY)
  quantity?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Upper end of a range' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY)
  quantityMax?: number | null;

  @ApiPropertyOptional({ nullable: true, description: "Women's amount" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY)
  quantityFemale?: number | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  maxEffort?: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Kilograms' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MAX_LOAD_KG)
  loadKg?: number | null;

  @ApiPropertyOptional({ nullable: true, description: "Women's load, kg" })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MAX_LOAD_KG)
  loadFemaleKg?: number | null;

  @ApiPropertyOptional({ nullable: true, description: '% of 1-rep max' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  loadPercent?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Interval of the rotation (EMOM minute 1, 2...)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  slot?: number | null;

  @ApiPropertyOptional({ nullable: true, maxLength: ITEM_NOTES_MAX_LENGTH })
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(ITEM_NOTES_MAX_LENGTH)
  notes?: string | null;
}

export class WorkoutVariantDto {
  @ApiProperty({ enum: WorkoutLevel })
  @IsEnum(WorkoutLevel)
  level!: WorkoutLevel;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  rounds?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    type: [Number],
    example: [21, 15, 9],
    description: 'Reps per round for the items without their own amount',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_REP_SCHEME)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(MAX_QUANTITY, { each: true })
  repScheme?: number[] | null;

  @ApiPropertyOptional({ nullable: true })
  @Seconds()
  durationSeconds?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Seconds()
  timeCapSeconds?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Seconds()
  intervalSeconds?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Seconds()
  workSeconds?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Seconds()
  restSeconds?: number | null;

  @ApiPropertyOptional({ nullable: true, maxLength: VARIANT_NOTES_MAX_LENGTH })
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(VARIANT_NOTES_MAX_LENGTH)
  notes?: string | null;

  @ApiProperty({ type: [WorkoutItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'each level needs at least one exercise' })
  @ArrayMaxSize(MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => WorkoutItemDto)
  items!: WorkoutItemDto[];
}

export class WorkoutPartDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'On update only: the id of the part of this workout that this one replaces, so it keeps its identity. Refused on create.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: WORKOUT_TITLE_MAX_LENGTH })
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(WORKOUT_TITLE_MAX_LENGTH)
  title?: string | null;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workoutTypeId!: string;

  @ApiPropertyOptional({
    enum: ScoreType,
    description: "Defaults to the workout type's score",
  })
  @IsOptional()
  @IsEnum(ScoreType)
  scoreType?: ScoreType;

  @ApiProperty({ type: [WorkoutVariantDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => WorkoutVariantDto)
  variants!: WorkoutVariantDto[];
}

export class CreateWorkoutDto {
  @ApiProperty({ example: '2026-11-09', description: 'The day, YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'date must be a real date' })
  date!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: WORKOUT_TITLE_MAX_LENGTH })
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(WORKOUT_TITLE_MAX_LENGTH)
  title?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: WORKOUT_NOTES_MAX_LENGTH })
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(WORKOUT_NOTES_MAX_LENGTH)
  notes?: string | null;

  @ApiProperty({ type: [WorkoutPartDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'a workout needs at least one part' })
  @ArrayMaxSize(MAX_PARTS)
  @ValidateNested({ each: true })
  @Type(() => WorkoutPartDto)
  parts!: WorkoutPartDto[];
}

export class UpdateWorkoutDto extends PartialType(CreateWorkoutDto) {}

export class ListWorkoutsQueryDto {
  @ApiPropertyOptional({ example: '2026-11-09', description: 'First day' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-15', description: 'Last day' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}
