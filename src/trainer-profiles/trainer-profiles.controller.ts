import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreateTrainerDto } from './dto/create-trainer.dto';
import { UpdateTrainerDto } from './dto/update-trainer.dto';
import { TrainerProfilesService } from './trainer-profiles.service';

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
}
