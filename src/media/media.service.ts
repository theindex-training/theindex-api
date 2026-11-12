import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { Readable } from 'stream';
import { In, Repository } from 'typeorm';
import {
  ListMediaQueryDto,
  MEDIA_PAGE_SIZE_DEFAULT,
} from './dto/list-media.query.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { UploadMediaDto } from './dto/upload-media.dto';
import {
  MediaConfig,
  isProduction,
  loadMediaConfig,
  loadPrivateMediaConfig,
} from './media.config';
import { MediaEntity, MediaFile } from './media.entity';
import {
  MEDIA_KINDS,
  MediaArea,
  MediaKind,
  contentTypeOf,
  itemFolder,
} from './media-kind';
import {
  OG_SIZE,
  ProcessedFile,
  UnsupportedImageError,
  processImage,
} from './media-processing';
import { LocalMediaStorage, MediaStorage } from './media-storage';

/** The parts of an uploaded file the service needs (a multer file has them). */
export interface UploadedMediaFile {
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

/**
 * An image as the public site gets it: the URLs, sizes and alt text, without the back office's
 * fields (file name, uploader).
 */
export interface PublicMedia {
  url: string;
  width: number;
  height: number;
  altText: string;
  /** WebP versions for `srcset`, narrowest first. */
  variants: MediaFileResponse[];
  /** 1200×630 JPEG crop for social previews. */
  ogImage: MediaFileResponse;
}

/** Kinds stored as uploaded, without processing: documents. */
export type DocumentKind = MediaKind.WORKOUT_PDF;

/** What each document kind is stored as. */
const DOCUMENT_FILES: Record<DocumentKind, { name: string }> = {
  [MediaKind.WORKOUT_PDF]: { name: 'original.pdf' },
};

/** A stored document as the owning feature shows it (e.g. a workout's source PDF). */
export interface StoredDocument {
  id: string;
  originalFilename: string | null;
  sizeBytes: number;
  uploadedAt: Date;
}

/** A document ready to be streamed to the client. */
export interface DocumentDownload {
  document: StoredDocument;
  contentType: string;
  /** The name to offer: the original file name, or the id with the stored file's extension. */
  filename: string;
  size: number;
  stream: Readable;
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
  private cachedPrivate?: MediaStorage;

  constructor(
    @InjectRepository(MediaEntity)
    private readonly repo: Repository<MediaEntity>,
  ) {}

  /**
   * Processes and stores an uploaded article image, then records it. The files are written
   * first; if the row can't be saved, they are removed again, so storage never keeps files
   * without a row.
   */
  async upload(
    file: UploadedMediaFile | undefined,
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
    const folder = itemFolder(MediaKind.ARTICLE_IMAGE, id);
    const files = [processed.master, ...processed.variants, processed.og];
    const saved = await this.writeThenRecord(storage, folder, async () => {
      for (const f of files) await storage.write(`${folder}/${f.name}`, f.data);
      return this.repo.save(
        this.repo.create({
          id,
          kind: MediaKind.ARTICLE_IMAGE,
          altText: dto.altText,
          masterPath: `${folder}/${processed.master.name}`,
          width: processed.master.width,
          height: processed.master.height,
          variants: processed.variants.map((v) => fileOf(folder, v)),
          ogPath: `${folder}/${processed.og.name}`,
          originalFilename: originalName(file.originalname),
          sizeBytes: file.size,
          uploadedByAccountId: accountId,
        }),
      );
    });
    return this.toResponse(saved);
  }

  /**
   * Stores a document as it was uploaded (the caller has checked that it is one: e.g. a PDF the
   * workout import could read). The same file uploaded again is stored once: its earlier item
   * is returned. Answers 503 when the kind's storage area is not configured.
   */
  async storeDocument(
    kind: DocumentKind,
    file: UploadedMediaFile,
    accountId: string | null,
  ): Promise<StoredDocument> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('file is required');
    }
    const storage = this.storage(MEDIA_KINDS[kind].area);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.repo.findOne({
      where: { kind, sha256 },
      order: { createdAt: 'ASC' },
    });
    if (existing) return storedDocument(existing);

    const id = randomUUID();
    const folder = itemFolder(kind, id);
    const path = `${folder}/${DOCUMENT_FILES[kind].name}`;
    const saved = await this.writeThenRecord(storage, folder, async () => {
      await storage.write(path, file.buffer);
      return this.repo.save(
        this.repo.create({
          id,
          kind,
          masterPath: path,
          originalFilename: originalName(file.originalname),
          sizeBytes: file.buffer.length,
          sha256,
          uploadedByAccountId: accountId,
        }),
      );
    });
    return storedDocument(saved);
  }

  /** A stored document of the kind, by id, if there is one. */
  async findDocument(
    kind: DocumentKind,
    id: string,
  ): Promise<StoredDocument | null> {
    const row = await this.repo.findOne({ where: { id, kind } });
    return row ? storedDocument(row) : null;
  }

  /**
   * A stored document of the kind, to stream it. 404 when there is no such document (another
   * kind's id included) or its file is missing from the storage (which is logged).
   */
  async openDocument(
    kind: DocumentKind,
    id: string,
  ): Promise<DocumentDownload> {
    const row = await this.repo.findOne({ where: { id, kind } });
    if (!row) throw new NotFoundException('File not found');
    const file = await this.storage(MEDIA_KINDS[kind].area).open(
      row.masterPath,
    );
    if (!file) {
      this.logger.error(
        `The file of media ${row.id} is missing: ${row.masterPath}`,
      );
      throw new NotFoundException('File not found');
    }
    const extension = /\.[a-z0-9]+$/i.exec(row.masterPath)?.[0] ?? '';
    return {
      document: storedDocument(row),
      contentType: contentTypeOf(row.masterPath),
      filename: row.originalFilename || `${row.id}${extension}`,
      size: file.size,
      stream: file.stream,
    };
  }

  /** The article image library, newest first. */
  async list(q: ListMediaQueryDto): Promise<MediaPage> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? MEDIA_PAGE_SIZE_DEFAULT;
    const [rows, total] = await this.repo.findAndCount({
      where: { kind: MediaKind.ARTICLE_IMAGE },
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

  /**
   * The public view of the given article images, by id; ids that match no article image (other
   * kinds included: they are never public) are left out. Needs the
   * media settings only when there is something to resolve, so articles without images work
   * even before media is configured.
   */
  async publicMedia(ids: string[]): Promise<Map<string, PublicMedia>> {
    const unique = [...new Set(ids)];
    const result = new Map<string, PublicMedia>();
    if (!unique.length) return result;
    const rows = await this.repo.find({
      where: { id: In(unique), kind: MediaKind.ARTICLE_IMAGE },
    });
    for (const media of rows) {
      const { url, width, height, altText, variants, ogImage } =
        this.toResponse(media);
      result.set(media.id, { url, width, height, altText, variants, ogImage });
    }
    return result;
  }

  /** An article image: the library's routes see no other kind. */
  private async findOrFail(id: string): Promise<MediaEntity> {
    const media = await this.repo.findOne({
      where: { id, kind: MediaKind.ARTICLE_IMAGE },
    });
    if (!media) throw new NotFoundException('Media not found');
    return media;
  }

  /**
   * Runs `write` (which writes the item's files, then saves its row). If it fails, the item's
   * folder is removed again, so storage never keeps files without a row.
   */
  private async writeThenRecord(
    storage: MediaStorage,
    folder: string,
    write: () => Promise<MediaEntity>,
  ): Promise<MediaEntity> {
    try {
      return await write();
    } catch (error) {
      await storage
        .removeFolder(folder)
        .catch((cleanupError: unknown) =>
          this.logger.error(
            `Could not remove media files of failed upload ${folder}`,
            cleanupError,
          ),
        );
      throw error;
    }
  }

  /** An article image as the API answers it (the image columns are set on that kind). */
  private toResponse(media: MediaEntity): MediaResponse {
    const { publicUrl } = this.setup().config;
    const url = (path: string) => `${publicUrl}/${path}`;
    return {
      id: media.id,
      altText: media.altText!,
      width: media.width!,
      height: media.height!,
      url: url(media.masterPath),
      variants: media.variants!.map((v) => ({
        url: url(v.path),
        width: v.width,
        height: v.height,
      })),
      ogImage: { url: url(media.ogPath!), ...OG_SIZE },
      originalFilename: media.originalFilename,
      sizeBytes: media.sizeBytes,
      uploadedByAccountId: media.uploadedByAccountId,
      createdAt: media.createdAt,
      updatedAt: media.updatedAt,
    };
  }

  private storage(area: MediaArea): MediaStorage {
    return area === 'public' ? this.setup().storage : this.privateStorage();
  }

  /**
   * The private area's storage, resolved on first use, apart from the public one: either works
   * without the other. A missing or invalid setting answers 503 and is logged.
   */
  private privateStorage(): MediaStorage {
    if (this.cachedPrivate) return this.cachedPrivate;
    let storageDir: string;
    try {
      ({ storageDir } = loadPrivateMediaConfig(process.env, {
        production: isProduction(process.env),
      }));
    } catch (error) {
      this.logger.error((error as Error).message);
      throw new ServiceUnavailableException('Media storage is not configured');
    }
    this.cachedPrivate = new LocalMediaStorage(storageDir);
    return this.cachedPrivate;
  }

  /**
   * Public config and storage, resolved on first use. A missing or invalid setting answers 503
   * and is logged; it never stops the API from starting (see media.config.ts).
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

function fileOf(folder: string, file: ProcessedFile): MediaFile {
  return {
    path: `${folder}/${file.name}`,
    width: file.width,
    height: file.height,
  };
}

function originalName(name: string | undefined): string | null {
  return name?.slice(0, 255) || null;
}

/** A document's row as the owning feature shows it. */
export function storedDocument(row: MediaEntity): StoredDocument {
  return {
    id: row.id,
    originalFilename: row.originalFilename,
    sizeBytes: row.sizeBytes,
    uploadedAt: row.createdAt,
  };
}
