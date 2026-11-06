import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TITLE_MAX_LENGTH, Trim } from './article-fields';

export class CreateArticleDto {
  @ApiProperty({
    example: 'Как да започнем с КросФит',
    maxLength: TITLE_MAX_LENGTH,
  })
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'title must not be empty' })
  @MaxLength(TITLE_MAX_LENGTH)
  title!: string;
}
