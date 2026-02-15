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
import { CreateAccountDto } from './dto/create-account.dto';
import { SetAccountStatusDto } from './dto/set-status.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('jwt')
@Roles(AccountRole.ADMIN)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Post()
  async createInvited(@Body() dto: CreateAccountDto) {
    const acc = await this.accounts.createInvited(dto);
    return this.accounts.sanitize(acc);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAccountDto) {
    const acc = await this.accounts.update(id, dto);
    return this.accounts.sanitize(acc);
  }

  @Patch(':id/status')
  async setStatus(@Param('id') id: string, @Body() dto: SetAccountStatusDto) {
    const acc = await this.accounts.setStatus(id, dto.status);
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
