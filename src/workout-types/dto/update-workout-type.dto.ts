import { PartialType } from '@nestjs/swagger';
import { CreateWorkoutTypeDto } from './create-workout-type.dto';

export class UpdateWorkoutTypeDto extends PartialType(CreateWorkoutTypeDto) {}
