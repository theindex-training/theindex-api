import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { requesterOf, TokenUser } from './benchmark-owner';
import { BenchmarkResultsService } from './benchmark-results.service';
import {
  CreateBenchmarkResultDto,
  MyResultsQueryDto,
  UpdateBenchmarkResultDto,
} from './dto/benchmark-result.dto';

type AuthenticatedRequest = { user: TokenUser };

/**
 * Logged results: trainees and trainers log, change and delete their own (the profile comes from
 * the token); an admin can delete anyone's. Admins without a profile have none of their own.
 */
@ApiTags('benchmarks')
@ApiBearerAuth('jwt')
@Controller('benchmark-results')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AccountRole.ADMIN, AccountRole.TRAINER, AccountRole.TRAINEE)
export class BenchmarkResultsController {
  constructor(private readonly service: BenchmarkResultsService) {}

  @Get('mine')
  mine(@Query() query: MyResultsQueryDto, @Req() req: AuthenticatedRequest) {
    return this.service.mine(requesterOf(req.user), query);
  }

  @Post()
  create(
    @Body() dto: CreateBenchmarkResultDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.create(requesterOf(req.user), dto);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.get(requesterOf(req.user), id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBenchmarkResultDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.update(requesterOf(req.user), id, dto);
  }

  @Delete(':id')
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.delete(requesterOf(req.user), id);
  }
}
