import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { GenerateSettlementDto } from './dto/generate-settlement.dto';
import { ListAllocationsQueryDto } from './dto/list-allocations.query.dto';
import { SettlementsService } from './settlements.service';

type SettlementJwtUser = {
  role: AccountRole;
  trainerProfileId?: string | null;
};

type AuthenticatedRequest = Request & {
  user: SettlementJwtUser;
};

@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('jwt')
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
@Controller('settlements')
export class SettlementsController {
  constructor(private readonly settlementsService: SettlementsService) {}

  private getTrainerProfileIdOrThrow(req: AuthenticatedRequest): string {
    const trainerProfileId = req.user.trainerProfileId;
    if (!trainerProfileId) {
      throw new ForbiddenException('Trainer profile is required for this action');
    }

    return trainerProfileId;
  }

  @Post()
  generate(@Body() dto: GenerateSettlementDto, @Req() req: AuthenticatedRequest) {
    if (req.user.role === AccountRole.TRAINER) {
      throw new ForbiddenException('TRAINER cannot generate settlement reports');
    }

    return this.settlementsService.generate(dto);
  }

  @Get()
  list() {
    return this.settlementsService.list();
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    if (req.user.role === AccountRole.TRAINER) {
      const trainerProfileId = this.getTrainerProfileIdOrThrow(req);
      return this.settlementsService.getById(id, trainerProfileId);
    }

    return this.settlementsService.getById(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    if (req.user.role === AccountRole.TRAINER) {
      throw new ForbiddenException('TRAINER cannot delete settlement reports');
    }

    return this.settlementsService.remove(id);
  }

  @Post(':id/finalize')
  finalize(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    if (req.user.role === AccountRole.TRAINER) {
      throw new ForbiddenException('TRAINER cannot finalize settlement reports');
    }

    return this.settlementsService.finalize(id);
  }

  @Get(':id/allocations')
  allocations(
    @Param('id') id: string,
    @Query() query: ListAllocationsQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    if (req.user.role === AccountRole.TRAINER) {
      const trainerProfileId = this.getTrainerProfileIdOrThrow(req);
      return this.settlementsService.allocations(id, {
        ...query,
        trainerId: trainerProfileId,
      });
    }

    return this.settlementsService.allocations(id, query);
  }
}
