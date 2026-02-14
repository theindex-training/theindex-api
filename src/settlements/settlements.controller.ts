import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { GenerateSettlementDto } from './dto/generate-settlement.dto';
import { ListAllocationsQueryDto } from './dto/list-allocations.query.dto';
import { SettlementsService } from './settlements.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('jwt')
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
@Controller('settlements')
export class SettlementsController {
  constructor(private readonly settlementsService: SettlementsService) {}

  @Post()
  generate(@Body() dto: GenerateSettlementDto) {
    return this.settlementsService.generate(dto);
  }

  @Get()
  list() {
    return this.settlementsService.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.settlementsService.getById(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.settlementsService.remove(id);
  }

  @Post(':id/finalize')
  finalize(@Param('id') id: string) {
    return this.settlementsService.finalize(id);
  }

  @Get(':id/allocations')
  allocations(
    @Param('id') id: string,
    @Query() query: ListAllocationsQueryDto,
  ) {
    return this.settlementsService.allocations(id, query);
  }
}
