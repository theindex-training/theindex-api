import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountsService } from './accounts.service';
import { CreateProvisionedAccountDto } from './dto/create-provisioned-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

type ProfileType = 'trainer' | 'trainee';

@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('jwt')
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Post(':profileType/:profileId')
  async create(
    @Param('profileType') profileType: ProfileType,
    @Param('profileId') profileId: string,
    @Body() dto: CreateProvisionedAccountDto,
  ) {
    const acc = await this.accounts.provisionForProfile(
      profileType,
      profileId,
      dto,
    );
    return this.accounts.sanitize(acc);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAccountDto) {
    const acc = await this.accounts.update(id, dto);
    return this.accounts.sanitize(acc);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    const acc = await this.accounts.delete(id);
    return this.accounts.sanitize(acc);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const acc = await this.accounts.findById(id);
    if (!acc) return null;
    return this.accounts.sanitize(acc);
  }
}
