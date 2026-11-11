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

/** The movement catalogue workouts list: ADMIN and TRAINER. */
@ApiTags('exercises')
@ApiBearerAuth('jwt')
@Controller('exercises')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
export class ExercisesController {
  constructor(private readonly service: ExercisesService) {}

  @Get()
  list(@Query() query: ListExercisesQueryDto) {
    return this.service.list(query);
  }

  @Post()
  create(@Body() dto: CreateExerciseDto) {
    return this.service.create(dto);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
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
