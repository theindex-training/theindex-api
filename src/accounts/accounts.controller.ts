import {
  Body,
  Controller,
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
import { ActivateAccountDto } from './dto/activate-account.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { SetAccountStatusDto } from './dto/set-status.dto';

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

  // Admin activates invited accounts (simple, later you can add invite token flow)
  @Post(':id/activate')
  async activate(@Param('id') id: string, @Body() dto: ActivateAccountDto) {
    const acc = await this.accounts.activate(id, dto);
    return this.accounts.sanitize(acc);
  }

  @Patch(':id/status')
  async setStatus(@Param('id') id: string, @Body() dto: SetAccountStatusDto) {
    const acc = await this.accounts.setStatus(id, dto.status);
    return this.accounts.sanitize(acc);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const acc = await this.accounts.findById(id);
    if (!acc) return null;
    return this.accounts.sanitize(acc);
  }
}
