import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
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

/**
 * `POST /api/account-setup`: the first-login form of an account an admin created, the same fields
 * as self-registration (`RegisterDto`). The new password is required while the account still has
 * the admin's one, and refused once it has been changed (Change password, with the current one).
 */
export class CompleteAccountSetupDto {
  @ApiProperty({ example: 'ivan.petrov@example.com', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Ivan Petrov', minLength: 2, maxLength: 100 })
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiPropertyOptional({
    example: 'my-password-1',
    minLength: 8,
    maxLength: 128,
    description:
      'Required while the account has the password an admin set; must differ from it. Refused otherwise.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional({
    example: 'my-password-1',
    minLength: 8,
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  confirmPassword?: string;

  @PhoneField('required')
  phone!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Trainees only: an active gym subscription (GET /api/auth/register/options); null for none',
  })
  @IsOptional()
  @IsUUID()
  gymSubscriptionId?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      "An active gym: a trainee's preferred gym, a trainer's primary gym; null for none",
  })
  @IsOptional()
  @IsUUID()
  homeGymId?: string | null;

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
