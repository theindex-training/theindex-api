import {
  Body,
  Controller,
  Get,
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
import { ALT_TEXT_MAX_LENGTH } from './dto/alt-text';
import { ListMediaQueryDto } from './dto/list-media.query.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { UploadMediaDto } from './dto/upload-media.dto';
import { MediaService, UploadedMediaFile } from './media.service';

type AuthenticatedRequest = {
  user: { sub: string; role: AccountRole };
};

/**
 * The media library: images for articles (theindex-web docs/decision-record.md, section 8).
 * ADMIN only in the MVP. There is no delete yet: articles may use any image.
 */
@ApiTags('media')
@ApiBearerAuth('jwt')
@Controller('media')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AccountRole.ADMIN)
export class MediaController {
  constructor(private readonly service: MediaService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'altText'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            'JPEG, PNG or WebP, up to MEDIA_MAX_UPLOAD_MB (15 MB by default)',
        },
        altText: { type: 'string', maxLength: ALT_TEXT_MAX_LENGTH },
      },
    },
  })
  upload(
    @UploadedFile() file: UploadedMediaFile | undefined,
    @Body() dto: UploadMediaDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.upload(file, dto, req.user.sub);
  }

  @Get()
  list(@Query() q: ListMediaQueryDto) {
    return this.service.list(q);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMediaDto) {
    return this.service.update(id, dto);
  }
}
