import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PhoneField, SocialLinkField } from '../../common/dto/contact-fields';

/**
 * `PATCH /api/my-profile`: what trainees and trainers change about themselves (a field left out
 * keeps its value). Never the name, the nickname (staff-only) or the email.
 */
export class UpdateMyProfileDto {
  @PhoneField('keep')
  phone?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Trainees only: an active gym subscription; null for none',
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
}
