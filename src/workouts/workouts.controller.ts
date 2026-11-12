import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
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
import { MediaKind, inlineDisposition } from '../media/media-kind';
import { MediaService } from '../media/media.service';
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
    private readonly media: MediaService,
  ) {}

  @Get()
  list(@Query() query: ListWorkoutsQueryDto) {
    return this.service.list(query);
  }

  @Post()
  create(@Body() dto: CreateWorkoutDto, @Req() req: AuthenticatedRequest) {
    return this.service.create(dto, req.user.sub);
  }

  /**
   * Reads a lesson-plan PDF into a draft for the form. Saves no workout; keeps the PDF, whose
   * `sourcePdf.id` the form sends as the workout's `sourcePdfId`.
   */
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
  importPdf(
    @UploadedFile() file: UploadedPdf | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.importer.fromPdf(file, req.user.sub);
  }

  /**
   * A kept lesson-plan PDF, by its id (a workout's `sourcePdf.id`, or the import's, before the
   * workout is saved), shown inline under its original name. These files are never public.
   */
  @Get('source-pdfs/:id')
  @Header('Cache-Control', 'private, no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  async sourcePdf(@Param('id', ParseUUIDPipe) id: string) {
    const file = await this.media.openDocument(MediaKind.WORKOUT_PDF, id);
    return new StreamableFile(file.stream, {
      type: file.contentType,
      length: file.size,
      disposition: inlineDisposition(file.filename),
    });
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
