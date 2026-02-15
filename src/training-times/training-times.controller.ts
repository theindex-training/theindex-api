import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { CreateTrainingTimeDto } from './dto/create-training-time.dto';
import { UpdateTrainingTimeDto } from './dto/update-training-time.dto';
import { TrainingTimesService } from './training-times.service';

@ApiTags('training-times')
@ApiBearerAuth('jwt')
@Controller('training-times')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
export class TrainingTimesController {
  constructor(private readonly service: TrainingTimesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id')
  edit(@Param('id') id: string) {
    return this.service.edit(id);
  }

  @Post()
  create(@Body() dto: CreateTrainingTimeDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTrainingTimeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
