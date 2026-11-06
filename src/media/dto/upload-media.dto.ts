import { ApiProperty } from '@nestjs/swagger';
import { ALT_TEXT_MAX_LENGTH, AltText } from './alt-text';

/** Text fields of the multipart upload; the image itself is the `file` part. */
export class UploadMediaDto {
  @ApiProperty({
    example: 'Атлет вдига щанга над главата си',
    maxLength: ALT_TEXT_MAX_LENGTH,
    description: 'What the image shows, for screen readers and search engines',
  })
  @AltText()
  altText!: string;
}
