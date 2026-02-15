import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { CreateTrainerDto } from './dto/create-trainer.dto';
import { UpdateTrainerDto } from './dto/update-trainer.dto';
import { TrainerProfilesService } from './trainer-profiles.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('jwt')
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
@Controller('trainers')
export class TrainerProfilesController {
  constructor(private readonly trainersService: TrainerProfilesService) {}

  @Get()
  list(@Query('active') active?: string) {
    const parsed = active === undefined ? undefined : active === 'true';
    return this.trainersService.list(parsed);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.trainersService.getById(id);
  }

  @Post()
  create(@Body() dto: CreateTrainerDto) {
    return this.trainersService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTrainerDto) {
    return this.trainersService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.trainersService.deactivate(id);
  }
}
