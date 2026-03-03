import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { CreateManualCashRegisterTransactionDto } from './dto/create-manual-cash-register-transaction.dto';
import { CashRegisterService } from './cash-register.service';

@ApiTags('cash-register')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AccountRole.ADMIN)
@Controller('cash-register')
export class CashRegisterController {
  constructor(private readonly service: CashRegisterService) {}

  @Get()
  getCurrentState() {
    return this.service.getCurrentState();
  }

  @Post('transactions/manual')
  createManualTransaction(@Body() dto: CreateManualCashRegisterTransactionDto) {
    return this.service.createManualTransaction(dto);
  }
}
