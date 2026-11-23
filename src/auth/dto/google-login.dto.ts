import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** "Sign in with Google": the ID token Google Identity Services gave the page. */
export class GoogleLoginDto {
  @ApiProperty({
    description:
      "The `credential` of Google Identity Services' sign-in callback (a Google ID token).",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  credential!: string;
}
