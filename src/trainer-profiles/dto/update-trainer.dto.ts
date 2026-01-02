import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class UpdateTrainerDto {
  @IsString()
  @Length(2, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  nickname?: string;

  @IsOptional()
  @IsUUID()
  accountId?: string | null; // allow unlink by sending null (handled in service)

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
