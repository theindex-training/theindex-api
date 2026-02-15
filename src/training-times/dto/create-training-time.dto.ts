import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class CreateTrainingTimeDto {
  @ApiProperty({
    example: '09:00',
    description: 'Training start time in 24h HH:mm format',
  })
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  startTime!: string;

  @ApiProperty({
    example: '10:30',
    description: 'Training end time in 24h HH:mm format',
  })
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  endTime!: string;
}
