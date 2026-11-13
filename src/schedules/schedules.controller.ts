import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import {
  CreateScheduleSlotDto,
  CreateScheduleWeekDto,
  CreateTemplateSlotDto,
  ScheduleWeekQueryDto,
  UpdateScheduleSlotDto,
  UpdateTemplateSlotDto,
} from './dto/schedule.dto';
import { SchedulesService } from './schedules.service';

type AuthenticatedRequest = { user: { sub: string } };

/**
 * A gym's usual week. Trainers read it (a week is created from it); only admins change it.
 */
@ApiTags('schedules')
@ApiBearerAuth('jwt')
@Controller('schedule-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AccountRole.ADMIN)
export class ScheduleTemplatesController {
  constructor(private readonly service: SchedulesService) {}

  @Get(':gymId')
  @Roles(AccountRole.ADMIN, AccountRole.TRAINER)
  get(@Param('gymId', ParseUUIDPipe) gymId: string) {
    return this.service.template(gymId);
  }

  @Post(':gymId/slots')
  addSlot(
    @Param('gymId', ParseUUIDPipe) gymId: string,
    @Body() dto: CreateTemplateSlotDto,
  ) {
    return this.service.addTemplateSlot(gymId, dto);
  }

  @Patch('slots/:id')
  updateSlot(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateSlotDto,
  ) {
    return this.service.updateTemplateSlot(id, dto);
  }

  @Delete('slots/:id')
  deleteSlot(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.deleteTemplateSlot(id);
  }
}

/** The gyms' real weeks, created from their templates: ADMIN and TRAINER. */
@ApiTags('schedules')
@ApiBearerAuth('jwt')
@Controller('schedules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
export class SchedulesController {
  constructor(private readonly service: SchedulesService) {}

  @Get()
  week(@Query() query: ScheduleWeekQueryDto) {
    return this.service.week(query);
  }

  @Post()
  createWeek(
    @Body() dto: CreateScheduleWeekDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.createWeek(dto, req.user.sub);
  }

  @Post(':weekId/slots')
  addSlot(
    @Param('weekId', ParseUUIDPipe) weekId: string,
    @Body() dto: CreateScheduleSlotDto,
  ) {
    return this.service.addSlot(weekId, dto);
  }

  /** One training with the trainees who booked it and what their subscriptions have left. */
  @Get('slots/:id')
  training(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.training(id);
  }

  @Patch('slots/:id')
  updateSlot(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScheduleSlotDto,
  ) {
    return this.service.updateSlot(id, dto);
  }

  @Delete('slots/:id')
  deleteSlot(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.deleteSlot(id);
  }
}
