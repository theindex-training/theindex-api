import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PreviewQueryDto {
  @ApiProperty({
    description: 'From POST /api/articles/:id/preview-token; valid 30 minutes',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  token!: string;
}
