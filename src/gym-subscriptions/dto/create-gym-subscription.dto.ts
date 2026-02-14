import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class CreateGymSubscriptionDto {
  @ApiProperty({
    example: 'Club card',
    minLength: 2,
    maxLength: 120,
    description: 'Gym subscription method name',
  })
  @IsString()
  @Length(2, 120)
  name!: string;
}
