import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { CreateTraineeDto } from './dto/create-trainee.dto';
import { UpdateTraineeDto } from './dto/update-trainee.dto';
import { TraineeProfilesService } from './trainee-profiles.service';

type TraineeJwtUser = {
  role: AccountRole;
  traineeProfileId?: string | null;
};

type AuthenticatedRequest = Request & {
  user: TraineeJwtUser;
};

@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('jwt')
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
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

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.traineesService.deactivate(id);
  }

  @Get(':id/overview')
  overview(@Param('id') id: string) {
    return this.traineesService.overview(id);
  }

  @Roles(AccountRole.TRAINEE)
  @Get('me/training-insights')
  myTrainingInsights(@Req() req: AuthenticatedRequest) {
    if (!req.user.traineeProfileId) {
      throw new ForbiddenException('Trainee profile is not linked to account');
    }

    return this.traineesService.trainingInsights(req.user.traineeProfileId);
  }
}
