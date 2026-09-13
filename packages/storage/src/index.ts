import type { Readable } from "node:stream";
import {
  GetObjectCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Минимальный интерфейс хранилища; его реализует и in-memory фейк в тестах. */
export interface StorageLike {
  put(key: string, body: Buffer | Readable, mime: string): Promise<void>;
  getSignedUrl(key: string, ttlSec?: number): Promise<string>;
}

export interface S3StorageOptions {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region?: string;
  /** Инъекция клиента для тестов */
  client?: S3Client;
  onWarn?: (message: string, err: unknown) => void;
}

export const SIGNED_URL_TTL_SEC = 24 * 60 * 60;
export const UPLOADS_PREFIX = "uploads/";
export const UPLOADS_EXPIRE_DAYS = 30;

/**
 * Адаптер S3-совместимого хранилища (minio в dev). forcePathStyle обязателен для minio.
 * Подписанные URL живут 24 ч (ТЗ §8); lifecycle: uploads/ удаляются через 30 дней.
 */
export class S3Storage implements StorageLike {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly onWarn: (message: string, err: unknown) => void;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    this.onWarn = options.onWarn ?? (() => undefined);
    this.client =
      options.client ??
      new S3Client({
        endpoint: options.endpoint,
        region: options.region ?? "us-east-1",
        credentials: { accessKeyId: options.accessKey, secretAccessKey: options.secretKey },
        forcePathStyle: true,
      });
  }

  async put(key: string, body: Buffer | Readable, mime: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: mime }),
    );
  }

  async getSignedUrl(key: string, ttlSec: number = SIGNED_URL_TTL_SEC): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSec,
    });
  }

  /** Best-effort: minio может не поддерживать все поля; неудача не роняет старт. */
  async applyLifecycleRules(): Promise<void> {
    try {
      await this.client.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: this.bucket,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: "expire-uploads",
                Status: "Enabled",
                Filter: { Prefix: UPLOADS_PREFIX },
                Expiration: { Days: UPLOADS_EXPIRE_DAYS },
              },
            ],
          },
        }),
      );
    } catch (err) {
      this.onWarn("failed to apply uploads lifecycle rule", err);
    }
  }
}
