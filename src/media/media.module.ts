import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  DEFAULT_MAX_UPLOAD_MB,
  isProduction,
  loadMediaConfig,
} from './media.config';
import { MediaController } from './media.controller';
import { MediaEntity } from './media.entity';
import { MediaService } from './media.service';

/** Upload size limit for multer. Falls back to the default when the config is incomplete
 * (the upload then fails with 503 in the service, which logs the problem). */
function maxUploadBytes(): number {
  try {
    return loadMediaConfig(process.env, {
      production: isProduction(process.env),
    }).maxUploadBytes;
  } catch {
    return DEFAULT_MAX_UPLOAD_MB * 1024 * 1024;
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([MediaEntity]),
    MulterModule.registerAsync({
      // No `dest`, so multer keeps the upload in memory (at most the limit) until it is processed;
      // only the processed files are written. A larger file is rejected with 413 while it is
      // still being received.
      useFactory: () => ({
        limits: { fileSize: maxUploadBytes(), files: 1, fields: 10 },
      }),
    }),
  ],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
