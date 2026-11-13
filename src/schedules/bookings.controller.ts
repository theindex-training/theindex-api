import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
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
import { BookingsService } from './bookings.service';
import { CreateBookingDto, ScheduleWeekQueryDto } from './dto/schedule.dto';

type TraineeRequest = { user: { traineeProfileId?: string | null } };

/** Trainees book their trainings here (their own bookings only). */
@ApiTags('bookings')
@ApiBearerAuth('jwt')
@Controller('bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AccountRole.TRAINEE)
export class BookingsController {
  constructor(private readonly service: BookingsService) {}

  @Get('gyms')
  gyms(@Req() req: TraineeRequest) {
    return this.service.gyms(traineeOf(req));
  }

  @Get('schedule')
  week(@Query() query: ScheduleWeekQueryDto, @Req() req: TraineeRequest) {
    return this.service.week(traineeOf(req), query);
  }

  /** One training with its gym and its whole workout (title, summary, exercises and videos). */
  @Get('trainings/:slotId')
  training(
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Req() req: TraineeRequest,
  ) {
    return this.service.training(traineeOf(req), slotId);
  }

  @Post()
  book(@Body() dto: CreateBookingDto, @Req() req: TraineeRequest) {
    return this.service.book(traineeOf(req), dto.slotId);
  }

  @Delete(':slotId')
  cancel(
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Req() req: TraineeRequest,
  ) {
    return this.service.cancel(traineeOf(req), slotId);
  }
}

function traineeOf(req: TraineeRequest): string {
  const id = req.user.traineeProfileId;
  if (!id) {
    throw new ForbiddenException(
      'Bookings need an account linked to a trainee profile',
    );
  }
  return id;
}
