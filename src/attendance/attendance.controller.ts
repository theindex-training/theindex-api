import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { AttendanceService } from './attendance.service';
import { AttendanceDatesQueryDto } from './dto/attendance-dates.query.dto';
import { AttendanceSessionsQueryDto } from './dto/attendance-sessions.query.dto';
import { CreateAttendanceBatchDto } from './dto/create-attendance-batch.dto';
import { CreateAttendanceDto } from './dto/create-attendance.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('jwt')
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
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
  @Get('dates')
  dates(@Query() query: AttendanceDatesQueryDto) {
    return this.attendanceService.dates(query);
  }

  @Get('sessions')
  sessions(@Query() query: AttendanceSessionsQueryDto) {
    return this.attendanceService.sessions(query);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.attendanceService.remove(id);
  }
}
