import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Patch,
  Put,
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
import { maxUploadBytes } from '../media/media.config';
import { UploadedMediaFile } from '../media/media.service';
import { PhotoCropDto } from '../profile-photos/dto/photo-crop.dto';
import { ProfilePhotosService } from '../profile-photos/profile-photos.service';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { MyProfileService } from './my-profile.service';

type AuthenticatedRequest = { user: { sub: string } };

/** A trainee's or trainer's own details; always their own (the account id from the token). */
@ApiTags('my-profile')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('jwt')
@Roles(AccountRole.TRAINEE, AccountRole.TRAINER)
@Controller('my-profile')
export class MyProfileController {
  constructor(private readonly service: MyProfileService) {}

  @Get()
  get(@Req() req: AuthenticatedRequest) {
    return this.service.get(req.user.sub);
  }

  @Patch()
  update(@Req() req: AuthenticatedRequest, @Body() dto: UpdateMyProfileDto) {
    return this.service.update(req.user.sub, dto);
  }
}

/**
 * The profile photo of "My details": always their own. `PUT` takes a new picture (multipart
 * `file`, JPEG, PNG or WebP) with the square chosen on it; `PATCH` crops the kept picture again;
 * `GET original` gives that picture back for the crop editor; `DELETE` removes the photo.
 */
@ApiTags('my-profile')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('jwt')
@Roles(AccountRole.TRAINEE, AccountRole.TRAINER)
@Controller('my-profile/photo')
export class MyProfilePhotoController {
  constructor(
    private readonly service: MyProfileService,
    private readonly photos: ProfilePhotosService,
  ) {}

  @Put()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: maxUploadBytes(), files: 1, fields: 10 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'x', 'y', 'width', 'height', 'rotation'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            'JPEG, PNG or WebP, up to MEDIA_MAX_UPLOAD_MB (15 MB by default)',
        },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        rotation: { type: 'number', enum: [0, 90, 180, 270] },
      },
    },
  })
  async replace(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: UploadedMediaFile | undefined,
    @Body() crop: PhotoCropDto,
  ) {
    const owner = await this.service.photoOwner(req.user.sub);
    return this.photos.replace(owner, file, crop, req.user.sub);
  }

  @Patch()
  async recrop(@Req() req: AuthenticatedRequest, @Body() crop: PhotoCropDto) {
    const owner = await this.service.photoOwner(req.user.sub);
    return this.photos.recrop(owner, crop, req.user.sub);
  }

  /** The kept picture (upright, without metadata), never cached: only its owner gets it. */
  @Get('original')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async original(@Req() req: AuthenticatedRequest) {
    const owner = await this.service.photoOwner(req.user.sub);
    const image = await this.photos.openOriginal(owner);
    return new StreamableFile(image.stream, {
      type: image.contentType,
      length: image.size,
    });
  }

  @Delete()
  @HttpCode(204)
  async remove(@Req() req: AuthenticatedRequest) {
    const owner = await this.service.photoOwner(req.user.sub);
    await this.photos.remove(owner);
  }
}
