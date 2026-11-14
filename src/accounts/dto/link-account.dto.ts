import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { PhoneField, SocialLinkField } from '../../common/dto/contact-fields';
import type { ProfileType } from '../account-view';

/**
 * `POST /api/accounts/:id/link`: connects an account to a trainee or trainer profile, an existing
 * one (`profileId`) or a new one. The other fields are what the profile stores, as the admin
 * decided; on an existing profile, a field left out keeps its value.
 */
export class LinkAccountDto {
  @ApiProperty({ enum: ['trainee', 'trainer'] })
  @IsIn(['trainee', 'trainer'])
  profileType!: ProfileType;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'An existing active profile without an account; left out to create a new profile',
  })
  @IsOptional()
  @IsUUID()
  profileId?: string;

  @ApiProperty({ example: 'Ivan Petrov', minLength: 2, maxLength: 100 })
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiPropertyOptional({
    example: 'Vanko',
    maxLength: 50,
    nullable: true,
    description: 'Internal nickname for staff (trainees never see it)',
  })
  @IsOptional()
  @IsString()
  @Length(0, 50)
  nickname?: string | null;

  @PhoneField('optional')
  phone?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Trainees only: an active gym subscription',
  })
  @IsOptional()
  @IsUUID()
  gymSubscriptionId?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      "An active gym: the trainee's preferred gym or the trainer's primary gym",
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
}
