import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { CreateWorkoutTypeDto } from './dto/create-workout-type.dto';
import { UpdateWorkoutTypeDto } from './dto/update-workout-type.dto';
import { WorkoutTypesService } from './workout-types.service';

/** Workout types (For time, AMRAP, EMOM...): ADMIN and TRAINER. */
@ApiTags('workout-types')
@ApiBearerAuth('jwt')
@Controller('workout-types')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
export class WorkoutTypesController {
  constructor(private readonly service: WorkoutTypesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() dto: CreateWorkoutTypeDto) {
    return this.service.create(dto);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkoutTypeDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.delete(id);
  }
}
