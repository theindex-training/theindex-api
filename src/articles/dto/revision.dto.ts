import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/**
 * The draft revision the admin is looking at. Publishing or discarding acts on exactly that
 * version, so changes saved meanwhile in another tab are never published or thrown away unseen
 * (409 instead).
 */
export class RevisionDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  baseRevision!: number;
}
