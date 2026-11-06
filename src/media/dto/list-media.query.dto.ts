import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const MEDIA_PAGE_SIZE_DEFAULT = 24;
export const MEDIA_PAGE_SIZE_MAX = 50;

export class ListMediaQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MEDIA_PAGE_SIZE_MAX,
    default: MEDIA_PAGE_SIZE_DEFAULT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MEDIA_PAGE_SIZE_MAX)
  pageSize?: number;
}
