import { PartialType } from '@nestjs/swagger';
import { CreateTrainingTimeDto } from './create-training-time.dto';

export class UpdateTrainingTimeDto extends PartialType(CreateTrainingTimeDto) {}
