import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import {
  ScheduleBookingEntity,
  ScheduleSlotEntity,
  ScheduleTemplateSlotEntity,
  ScheduleWeekEntity,
} from './schedule.entity';
import {
  ScheduleTemplatesController,
  SchedulesController,
} from './schedules.controller';
import { SchedulesService } from './schedules.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ScheduleTemplateSlotEntity,
      ScheduleWeekEntity,
      ScheduleSlotEntity,
      ScheduleBookingEntity,
    ]),
  ],
  controllers: [
    ScheduleTemplatesController,
    SchedulesController,
    BookingsController,
  ],
  providers: [SchedulesService, BookingsService],
  exports: [SchedulesService, BookingsService],
})
export class SchedulesModule {}
