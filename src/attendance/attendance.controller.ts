import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
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
import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { AttendanceService } from './attendance.service';
import { AttendanceDatesQueryDto } from './dto/attendance-dates.query.dto';
import { AttendanceSessionsQueryDto } from './dto/attendance-sessions.query.dto';
import { CreateAttendanceBatchDto } from './dto/create-attendance-batch.dto';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { InactiveTraineesQueryDto } from './dto/inactive-trainees.query.dto';

type AttendanceJwtUser = {
  role: AccountRole;
  traineeProfileId?: string | null;
};

type AuthenticatedRequest = Request & {
  user: AttendanceJwtUser;
};

@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('jwt')
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  private validateTraineeScopeOrThrow(
    req: AuthenticatedRequest,
    traineeId: string,
  ) {
    if (req.user.role !== AccountRole.TRAINEE) {
      return;
    }

    if (!req.user.traineeProfileId || req.user.traineeProfileId !== traineeId) {
      throw new ForbiddenException(
        'TRAINEE can only access trainings for their own trainee profile',
      );
    }
  }

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

  @Get('reports/inactive-trainees')
  listTraineesWithoutRecentTrainings(@Query() query: InactiveTraineesQueryDto) {
    return this.attendanceService.listTraineesWithoutRecentTrainings(query);
  }

  @Get('reports/without-active-subscription')
  listTraineesWithoutActiveSubscription() {
    return this.attendanceService.listTraineesWithoutActiveSubscription();
  }

  @Roles(AccountRole.ADMIN, AccountRole.TRAINER, AccountRole.TRAINEE)
  @Get('trainees/:traineeId')
  listForTrainee(
    @Param('traineeId') traineeId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.validateTraineeScopeOrThrow(req, traineeId);

    return this.attendanceService.listForTraineeByPaymentStatus(traineeId);
  }

  @Roles(AccountRole.ADMIN, AccountRole.TRAINER, AccountRole.TRAINEE)
  @Get('trainees/:traineeId/unpaid')
  listUnpaidForTrainee(
    @Param('traineeId') traineeId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.validateTraineeScopeOrThrow(req, traineeId);

    return this.attendanceService.listForTraineeByPaymentStatus(
      traineeId,
      AttendancePaymentStatus.UNPAID,
    );
  }

  @Roles(AccountRole.ADMIN, AccountRole.TRAINER, AccountRole.TRAINEE)
  @Get('trainees/:traineeId/paid')
  listPaidForTrainee(
    @Param('traineeId') traineeId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.validateTraineeScopeOrThrow(req, traineeId);

    return this.attendanceService.listForTraineeByPaymentStatus(
      traineeId,
      AttendancePaymentStatus.PAID,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.attendanceService.remove(id);
  }
}
