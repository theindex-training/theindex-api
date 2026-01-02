import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { GenerateSettlementDto } from './dto/generate-settlement.dto';
import { ListAllocationsQueryDto } from './dto/list-allocations.query.dto';
import { SettlementsService } from './settlements.service';

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
