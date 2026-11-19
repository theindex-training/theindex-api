import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { ListAllocationsQueryDto } from './dto/list-allocations.query.dto';
import { SettlementsService } from './settlements.service';

type SettlementJwtUser = {
  role: AccountRole;
  trainerProfileId?: string | null;
};

type AuthenticatedRequest = Request & {
  user: SettlementJwtUser;
};

/**
 * Settlement reports are created automatically, one per half month (`SettlementsCronService`):
 * staff review them and an admin finalizes them, oldest first. Nobody chooses a period or deletes
 * a report; `create-due` only runs the job's own rule on demand.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('jwt')
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
@Controller('settlements')
export class SettlementsController {
  constructor(private readonly settlementsService: SettlementsService) {}

  private getTrainerProfileIdOrThrow(req: AuthenticatedRequest): string {
    const trainerProfileId = req.user.trainerProfileId;
    if (!trainerProfileId) {
      throw new ForbiddenException(
        'Trainer profile is required for this action',
      );
    }

    return trainerProfileId;
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

  @ApiOperation({
    summary:
      'ADMIN: create the settlement reports that are due now, as the daily 04:00 (Europe/Sofia) job does: every half month after the latest report whose period is over, oldest first. 409 when none is due. For checks and retries; the front never calls it.',
  })
  @Roles(AccountRole.ADMIN)
  @Post('create-due')
  createDue() {
    return this.settlementsService.createDueReportsNow();
  }

  @Post(':id/finalize')
  finalize(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    if (req.user.role === AccountRole.TRAINER) {
      throw new ForbiddenException(
        'TRAINER cannot finalize settlement reports',
      );
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
