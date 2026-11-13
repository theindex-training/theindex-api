import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PhoneField, SocialLinkField } from '../../common/dto/contact-fields';

/** `POST /api/auth/register`: anyone creates their own account. */
export class RegisterDto {
  @ApiProperty({ example: 'ivan.petrov@example.com', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'my-password-1', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: 'my-password-1', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  confirmPassword!: string;

  @ApiProperty({
    example: 'Ivan Petrov',
    minLength: 2,
    maxLength: 100,
    description: 'Full name; an admin decides the profile name when connecting',
  })
  @IsString()
  @Length(2, 100)
  name!: string;

  @PhoneField('required')
  phone!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'An active gym subscription (GET /api/auth/register/options)',
  })
  @IsOptional()
  @IsUUID()
  gymSubscriptionId?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'An active gym (GET /api/auth/register/options)',
  })
  @IsOptional()
  @IsUUID()
  preferredGymId?: string | null;

  @SocialLinkField('instagram')
  instagram?: string | null;

  @SocialLinkField('facebook')
  facebook?: string | null;

  @SocialLinkField('tiktok')
  tiktok?: string | null;

  @ApiProperty({
    example: true,
    description:
      'Must be true: the person agrees to the use of their personal data and to receiving emails',
  })
  @Equals(true, {
    message:
      'You must agree to the use of your personal data and to receiving emails',
  })
  acceptTerms!: boolean;
}
