import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { PhoneField, SocialLinkField } from '../../common/dto/contact-fields';

export class CreateTrainerDto {
  @ApiProperty({
    example: 'Velcho',
    minLength: 2,
    maxLength: 100,
    description: 'Trainer full name',
  })
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiPropertyOptional({
    example: 'V',
    minLength: 1,
    maxLength: 50,
    description: 'Optional nickname used inside the gym',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  nickname?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional accountId for later linking to an account',
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the trainer is active',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'The gym the trainer mainly leads trainings in (an active gym); null for none',
  })
  @IsOptional()
  @IsUUID()
  primaryGymId?: string | null;

  @PhoneField('optional')
  phone?: string | null;

  @SocialLinkField('instagram')
  instagram?: string | null;

  @SocialLinkField('facebook')
  facebook?: string | null;

  @SocialLinkField('tiktok')
  tiktok?: string | null;
}
