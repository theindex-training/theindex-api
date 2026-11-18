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
import { BenchmarksService } from './benchmarks.service';
import {
  CreateBenchmarkDto,
  LeaderboardsQueryDto,
  ListBenchmarksQueryDto,
  UpdateBenchmarkDto,
} from './dto/benchmark.dto';

type AuthenticatedRequest = { user: TokenUser };

const EVERYONE = [AccountRole.ADMIN, AccountRole.TRAINER, AccountRole.TRAINEE];

/**
 * The catalogue of benchmarks and heavy lifts: everyone reads it (trainees only the active ones)
 * and each one's leaderboards; ADMIN and TRAINER change it.
 */
@ApiTags('benchmarks')
@ApiBearerAuth('jwt')
@Controller('benchmarks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
export class BenchmarksController {
  constructor(
    private readonly service: BenchmarksService,
    private readonly results: BenchmarkResultsService,
  ) {}

  @Get()
  @Roles(...EVERYONE)
  list(
    @Query() query: ListBenchmarksQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.list(query, req.user.role === AccountRole.TRAINEE);
  }

  @Post()
  create(@Body() dto: CreateBenchmarkDto) {
    return this.service.create(dto);
  }

  @Get(':id')
  @Roles(...EVERYONE)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  /** Each person once with their best result, best first; Rx and scaled apart. */
  @Get(':id/leaderboard')
  @Roles(...EVERYONE)
  leaderboard(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.results.leaderboard(requesterOf(req.user), id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBenchmarkDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.delete(id);
  }
}

/** The records page: every active benchmark (or heavy lift) with the top of its leaderboards. */
@ApiTags('benchmarks')
@ApiBearerAuth('jwt')
@Controller('leaderboards')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...EVERYONE)
export class LeaderboardsController {
  constructor(private readonly results: BenchmarkResultsService) {}

  @Get()
  overview(
    @Query() query: LeaderboardsQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.results.overview(requesterOf(req.user), query.kind);
  }
}
