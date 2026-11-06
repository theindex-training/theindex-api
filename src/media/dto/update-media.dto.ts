import { ApiProperty } from '@nestjs/swagger';
import { ALT_TEXT_MAX_LENGTH, AltText } from './alt-text';

export class UpdateMediaDto {
  @ApiProperty({ maxLength: ALT_TEXT_MAX_LENGTH })
  @AltText()
  altText!: string;
}
