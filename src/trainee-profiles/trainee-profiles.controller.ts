import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreateTraineeDto } from './dto/create-trainee.dto';
import { UpdateTraineeDto } from './dto/update-trainee.dto';
import { TraineeProfilesService } from './trainee-profiles.service';

@Controller('trainees')
export class TraineeProfilesController {
  constructor(private readonly traineesService: TraineeProfilesService) {}

  @Get()
  list(@Query('search') search?: string, @Query('active') active?: string) {
    const parsedActive = active === undefined ? undefined : active === 'true';
    return this.traineesService.list({ search, active: parsedActive });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.traineesService.getById(id);
  }

  @Post()
  create(@Body() dto: CreateTraineeDto) {
    return this.traineesService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTraineeDto) {
    return this.traineesService.update(id, dto);
  }

  @Get(':id/overview')
  overview(@Param('id') id: string) {
    return this.traineesService.overview(id);
  }
}
