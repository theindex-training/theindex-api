import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, Max, Min } from 'class-validator';
import { PHOTO_ROTATIONS } from '../../media/profile-photo-processing';
import type { PhotoRotation } from '../../media/profile-photo-processing';

/**
 * The square chosen on a profile photo's picture, as fractions (0–1) of its width and height
 * after turning it by `rotation` degrees clockwise. Sent as JSON, or as multipart fields beside
 * the file (hence the conversions).
 */
export class PhotoCropDto {
  @ApiProperty({ minimum: 0, maximum: 1, example: 0.2 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  x!: number;

  @ApiProperty({ minimum: 0, maximum: 1, example: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  y!: number;

  @ApiProperty({ minimum: 0, maximum: 1, example: 0.6 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  width!: number;

  @ApiProperty({ minimum: 0, maximum: 1, example: 0.8 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  height!: number;

  @ApiProperty({ enum: PHOTO_ROTATIONS, default: 0 })
  @Type(() => Number)
  @IsIn(PHOTO_ROTATIONS)
  rotation!: PhotoRotation;
}
