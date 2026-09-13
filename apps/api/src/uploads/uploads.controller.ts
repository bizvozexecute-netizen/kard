import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { FileInterceptor } from "@nestjs/platform-express";
import { ValidationError } from "@kadr/shared";
import type { StorageLike } from "@kadr/storage";
import sharp, { type OutputInfo } from "sharp";
import { CurrentUser } from "../auth/decorators";
import type { AuthUser } from "../auth/token.service";
import { PrismaService } from "../prisma/prisma.service";
import { STORAGE } from "../storage/storage.module";
import { detectImage } from "./magic-bytes";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_SIDE_PX = 2048;

@Controller("uploads")
export class UploadsController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE) private readonly storage: StorageLike,
  ) {}

  /**
   * POST /v1/uploads: multipart-поле file ≤ 10 МБ, только jpg/png/webp по magic bytes.
   * sharp: авто-поворот по EXIF, ресайз до 2048 по длинной стороне; метаданные
   * (EXIF/GPS) в выходной файл не попадают.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new ValidationError({ reason: "file_field_required" });

    const detected = detectImage(file.buffer);
    if (!detected) throw new ValidationError({ reason: "unsupported_image_type" });

    let processed: { data: Buffer; info: OutputInfo };
    try {
      processed = await sharp(file.buffer)
        .rotate() // применяет EXIF-ориентацию; метаданные не копируются
        .resize(MAX_SIDE_PX, MAX_SIDE_PX, { fit: "inside", withoutEnlargement: true })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new ValidationError({ reason: "corrupted_image" });
    }

    const id = randomUUID();
    const key = `uploads/${user.id}/${id}.${detected.ext}`;
    await this.storage.put(key, processed.data, detected.mime);

    const upload = await this.prisma.upload.create({
      data: {
        id,
        userId: user.id,
        key,
        mime: detected.mime,
        width: processed.info.width,
        height: processed.info.height,
        sizeBytes: processed.data.length,
      },
    });

    return {
      imageId: upload.id,
      url: await this.storage.getSignedUrl(key),
      width: upload.width,
      height: upload.height,
    };
  }
}
