import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { TrainingCalendarQueryDto } from './dto/schedule.dto';

/**
 * A booked training's calendar file, with **no guard**: Apple Calendar (and any app that opens an
 * `.ics` link) fetches it without the trainee's login, so the signed `token` from the trainee's
 * `GET /api/bookings/trainings/:slotId` is the only key (`calendar-token.ts`). In its own
 * controller, so the guarded bookings routes can't lose their guard by sharing one.
 */
@ApiTags('bookings')
@Controller('bookings')
export class TrainingCalendarController {
  constructor(private readonly service: BookingsService) {}

  @Get('calendar.ics')
  @ApiProduces('text/calendar')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="crossfit-training.ics"')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Robots-Tag', 'noindex')
  calendar(@Query() query: TrainingCalendarQueryDto) {
    return this.service.calendar(query.token, query.lang ?? 'bg');
  }
}
