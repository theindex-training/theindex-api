import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceDatesQueryDto } from './dto/attendance-dates.query.dto';
import { AttendanceSessionsQueryDto } from './dto/attendance-sessions.query.dto';
import { CreateAttendanceBatchDto } from './dto/create-attendance-batch.dto';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { ListAttendanceQueryDto } from './dto/list-attendance.query.dto';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post()
  create(@Body() dto: CreateAttendanceDto) {
    return this.attendanceService.create(dto);
  }

  @Post('batch')
  createBatch(@Body() dto: CreateAttendanceBatchDto) {
    return this.attendanceService.createBatch(dto);
  }

  @Get()
  list(@Query() query: ListAttendanceQueryDto) {
    return this.attendanceService.list(query);
  }

  @Get('dates')
  dates(@Query() query: AttendanceDatesQueryDto) {
    return this.attendanceService.dates(query);
  }

  @Get('sessions')
  sessions(@Query() query: AttendanceSessionsQueryDto) {
    return this.attendanceService.sessions(query);
  }
}
