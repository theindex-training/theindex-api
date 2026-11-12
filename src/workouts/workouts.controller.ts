import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import {
  CreateWorkoutDto,
  ListWorkoutsQueryDto,
  UpdateWorkoutDto,
} from './dto/workout.dto';
import {
  UploadedPdf,
  WORKOUT_PDF_MAX_BYTES,
  WorkoutImportService,
} from './import/workout-import.service';
import { WorkoutsService } from './workouts.service';

type AuthenticatedRequest = { user: { sub: string } };

/**
 * Workouts of the day: ADMIN and TRAINER. Trainees have no access yet (they will see the next
 * day's workout from the evening before, in a later step).
 */
@ApiTags('workouts')
@ApiBearerAuth('jwt')
@Controller('workouts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
export class WorkoutsController {
  constructor(
    private readonly service: WorkoutsService,
    private readonly importer: WorkoutImportService,
  ) {}

  @Get()
  list(@Query() query: ListWorkoutsQueryDto) {
    return this.service.list(query);
  }

  @Post()
  create(@Body() dto: CreateWorkoutDto, @Req() req: AuthenticatedRequest) {
    return this.service.create(dto, req.user.sub);
  }

  /** Reads a lesson-plan PDF into a draft for the form. Saves nothing. */
  @Post('import-pdf')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: WORKOUT_PDF_MAX_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  importPdf(@UploadedFile() file: UploadedPdf | undefined) {
    return this.importer.fromPdf(file);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkoutDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.delete(id);
  }
}
