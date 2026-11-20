import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { AddAliasDto } from './dto/add-alias.dto';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { ListExercisesQueryDto } from './dto/list-exercises.query.dto';
import { UpdateExerciseDto } from './dto/update-exercise.dto';
import { ExercisesService } from './exercises.service';

type AuthenticatedRequest = { user: { role: AccountRole } };

const EVERYONE = [AccountRole.ADMIN, AccountRole.TRAINER, AccountRole.TRAINEE];

/**
 * The movement catalogue workouts list: ADMIN and TRAINER change it. Trainees read it as their
 * exercise library: the active exercises only.
 */
@ApiTags('exercises')
@ApiBearerAuth('jwt')
@Controller('exercises')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
export class ExercisesController {
  constructor(private readonly service: ExercisesService) {}

  @Get()
  @Roles(...EVERYONE)
  list(
    @Query() query: ListExercisesQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.list(query, req.user.role === AccountRole.TRAINEE);
  }

  @Post()
  create(@Body() dto: CreateExerciseDto) {
    return this.service.create(dto);
  }

  @Get(':id')
  @Roles(...EVERYONE)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.get(id, req.user.role === AccountRole.TRAINEE);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExerciseDto,
  ) {
    return this.service.update(id, dto);
  }

  /** Adds another spelling (e.g. a lesson plan's) to the exercise's other names. */
  @Post(':id/aliases')
  @HttpCode(200)
  addAlias(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddAliasDto) {
    return this.service.addAlias(id, dto.alias);
  }

  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.delete(id);
  }
}
