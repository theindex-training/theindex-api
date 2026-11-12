import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
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
    ]),
  ],
  controllers: [ScheduleTemplatesController, SchedulesController],
  providers: [SchedulesService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
