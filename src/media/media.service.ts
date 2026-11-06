import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import {
  ListMediaQueryDto,
  MEDIA_PAGE_SIZE_DEFAULT,
} from './dto/list-media.query.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { UploadMediaDto } from './dto/upload-media.dto';
import { MediaConfig, isProduction, loadMediaConfig } from './media.config';
import { MediaEntity, MediaFile } from './media.entity';
import {
  OG_SIZE,
  ProcessedFile,
  UnsupportedImageError,
  processImage,
} from './media-processing';
import { LocalMediaStorage, MediaStorage } from './media-storage';

/** The parts of an uploaded file the service needs (a multer file has them). */
export interface UploadedImage {
  buffer: Buffer;
  originalname?: string;
  size: number;
}

export interface MediaFileResponse {
  url: string;
  width: number;
  height: number;
}

export interface MediaResponse {
  id: string;
  altText: string;
  width: number;
  height: number;
  /** The master file: full size, upright, metadata removed. */
  url: string;
  /** WebP versions for `srcset`, narrowest first. */
  variants: MediaFileResponse[];
  /** 1200×630 JPEG crop for social previews. */
  ogImage: MediaFileResponse;
  originalFilename: string | null;
  sizeBytes: number;
  uploadedByAccountId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MediaPage {
  items: MediaResponse[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private cached?: { config: MediaConfig; storage: MediaStorage };

  constructor(
    @InjectRepository(MediaEntity)
    private readonly repo: Repository<MediaEntity>,
  ) {}

  /**
   * Processes and stores an uploaded image, then records it. The files are written first; if the
   * row can't be saved, they are removed again, so storage never keeps files without a row.
   */
  async upload(
    file: UploadedImage | undefined,
    dto: UploadMediaDto,
    accountId: string | null,
  ): Promise<MediaResponse> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('file is required');
    }
    const { storage } = this.setup();

    let processed: Awaited<ReturnType<typeof processImage>>;
    try {
      processed = await processImage(file.buffer);
    } catch (error) {
      if (error instanceof UnsupportedImageError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const id = randomUUID();
    const files = [processed.master, ...processed.variants, processed.og];
    try {
      for (const f of files) await storage.write(`${id}/${f.name}`, f.data);
      const saved = await this.repo.save(
        this.repo.create({
          id,
          altText: dto.altText,
          masterPath: `${id}/${processed.master.name}`,
          width: processed.master.width,
          height: processed.master.height,
          variants: processed.variants.map((v) => fileOf(id, v)),
          ogPath: `${id}/${processed.og.name}`,
          originalFilename: file.originalname?.slice(0, 255) || null,
          sizeBytes: file.size,
          uploadedByAccountId: accountId,
        }),
      );
      return this.toResponse(saved);
    } catch (error) {
      await storage
        .removeFolder(id)
        .catch((cleanupError: unknown) =>
          this.logger.error(
            `Could not remove media files of failed upload ${id}`,
            cleanupError,
          ),
        );
      throw error;
    }
  }

  /** The media library, newest first. */
  async list(q: ListMediaQueryDto): Promise<MediaPage> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? MEDIA_PAGE_SIZE_DEFAULT;
    const [rows, total] = await this.repo.findAndCount({
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      items: rows.map((r) => this.toResponse(r)),
      total,
      page,
      pageSize,
    };
  }

  async get(id: string): Promise<MediaResponse> {
    return this.toResponse(await this.findOrFail(id));
  }

  async update(id: string, dto: UpdateMediaDto): Promise<MediaResponse> {
    const media = await this.findOrFail(id);
    media.altText = dto.altText;
    return this.toResponse(await this.repo.save(media));
  }

  private async findOrFail(id: string): Promise<MediaEntity> {
    const media = await this.repo.findOne({ where: { id } });
    if (!media) throw new NotFoundException('Media not found');
    return media;
  }

  private toResponse(media: MediaEntity): MediaResponse {
    const { publicUrl } = this.setup().config;
    const url = (path: string) => `${publicUrl}/${path}`;
    return {
      id: media.id,
      altText: media.altText,
      width: media.width,
      height: media.height,
      url: url(media.masterPath),
      variants: media.variants.map((v) => ({
        url: url(v.path),
        width: v.width,
        height: v.height,
      })),
      ogImage: { url: url(media.ogPath), ...OG_SIZE },
      originalFilename: media.originalFilename,
      sizeBytes: media.sizeBytes,
      uploadedByAccountId: media.uploadedByAccountId,
      createdAt: media.createdAt,
      updatedAt: media.updatedAt,
    };
  }

  /**
   * Config and storage, resolved on first use. A missing or invalid setting answers 503 and is
   * logged; it never stops the API from starting (see media.config.ts).
   */
  private setup(): { config: MediaConfig; storage: MediaStorage } {
    if (this.cached) return this.cached;
    let config: MediaConfig;
    try {
      config = loadMediaConfig(process.env, {
        production: isProduction(process.env),
      });
    } catch (error) {
      this.logger.error((error as Error).message);
      throw new ServiceUnavailableException('Media storage is not configured');
    }
    this.cached = { config, storage: new LocalMediaStorage(config.storageDir) };
    return this.cached;
  }
}

function fileOf(id: string, file: ProcessedFile): MediaFile {
  return { path: `${id}/${file.name}`, width: file.width, height: file.height };
}
