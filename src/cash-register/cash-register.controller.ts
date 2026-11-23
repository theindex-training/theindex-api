import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { CashRegisterQueryDto } from './dto/cash-register.query.dto';
import { CreateManualCashRegisterTransactionDto } from './dto/create-manual-cash-register-transaction.dto';
import { CashRegisterService } from './cash-register.service';

@ApiTags('cash-register')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AccountRole.ADMIN)
@Controller('cash-register')
export class CashRegisterController {
  constructor(private readonly service: CashRegisterService) {}

  /** The balance and a page of the transactions, newest first (`offset`, `limit`: 50, up to 500). */
  @Get()
  getCurrentState(@Query() query: CashRegisterQueryDto) {
    return this.service.getCurrentState(query);
  }

  @Post('transactions/manual')
  createManualTransaction(@Body() dto: CreateManualCashRegisterTransactionDto) {
    return this.service.createManualTransaction(dto);
  }
}
