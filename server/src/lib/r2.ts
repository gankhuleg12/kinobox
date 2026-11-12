import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { settings } from '../modules/settings/settings.service.js';

/**
 * Cloudflare R2 (S3-compatible) client. Тохиргоо нь Admin Panel-ээс ирэх тул
 * тохиргоо өөрчлөгдөхөд client-ийг дахин үүсгэнэ.
 */
interface R2Config {
  client: S3Client;
  mediaBucket: string;
  assetsBucket: string;
  assetsPublicUrl: string;
  segmentUrlTtlSec: number;
}

let current: { fingerprint: string; cfg: R2Config } | null = null;

async function config(): Promise<R2Config> {
  const s = await settings.require(['r2.accountId', 'r2.accessKeyId', 'r2.secretAccessKey', 'r2.mediaBucket', 'r2.assetsBucket'], 'Cloudflare R2');
  const extra = await settings.getMany(['r2.assetsPublicUrl', 'r2.segmentUrlTtlSec']);
  const fingerprint = [s['r2.accountId'], s['r2.accessKeyId'], s['r2.secretAccessKey']].join('|');

  if (!current || current.fingerprint !== fingerprint) {
    current?.cfg.client.destroy();
    current = {
      fingerprint,
      cfg: {
        client: new S3Client({
          region: 'auto',
          endpoint: `https://${s['r2.accountId']}.r2.cloudflarestorage.com`,
          credentials: { accessKeyId: s['r2.accessKeyId'], secretAccessKey: s['r2.secretAccessKey'] },
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
        }),
        mediaBucket: s['r2.mediaBucket'],
        assetsBucket: s['r2.assetsBucket'],
        assetsPublicUrl: extra['r2.assetsPublicUrl'],
        segmentUrlTtlSec: extra['r2.segmentUrlTtlSec'],
      },
    };
  }
  // Bucket нэр, URL өөрчлөгдсөн байж болох тул үргэлж шинэчилнэ
  current.cfg.mediaBucket = s['r2.mediaBucket'];
  current.cfg.assetsBucket = s['r2.assetsBucket'];
  current.cfg.assetsPublicUrl = extra['r2.assetsPublicUrl'];
  current.cfg.segmentUrlTtlSec = extra['r2.segmentUrlTtlSec'];
  return current.cfg;
}

export type Bucket = 'media' | 'assets';
const bucketName = (cfg: R2Config, b: Bucket) => (b === 'media' ? cfg.mediaBucket : cfg.assetsBucket);

export const r2 = {
  config,

  async put(bucket: Bucket, key: string, body: Buffer | Readable, contentType: string, cacheControl?: string, contentLength?: number) {
    const cfg = await config();
    await cfg.client.send(
      new PutObjectCommand({
        Bucket: bucketName(cfg, bucket),
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
        ContentLength: contentLength,
      }),
    );
  },

  async getText(bucket: Bucket, key: string): Promise<string> {
    const cfg = await config();
    const res = await cfg.client.send(new GetObjectCommand({ Bucket: bucketName(cfg, bucket), Key: key }));
    return (await res.Body?.transformToString('utf-8')) ?? '';
  },

  async download(bucket: Bucket, key: string, destPath: string) {
    const cfg = await config();
    const res = await cfg.client.send(new GetObjectCommand({ Bucket: bucketName(cfg, bucket), Key: key }));
    if (!res.Body) throw new Error(`Empty object: ${key}`);
    await pipeline(res.Body as Readable, createWriteStream(destPath));
  },

  /** Хувийн (private) объектод богино хугацааны унших URL */
  async presignGet(key: string, expiresIn?: number) {
    const cfg = await config();
    return getSignedUrl(cfg.client, new GetObjectCommand({ Bucket: cfg.mediaBucket, Key: key }), {
      expiresIn: expiresIn ?? cfg.segmentUrlTtlSec,
    });
  },

  async deletePrefix(bucket: Bucket, prefix: string) {
    if (!prefix || prefix === '/') throw new Error('Refusing to delete empty prefix');
    const cfg = await config();
    const Bucket = bucketName(cfg, bucket);
    let token: string | undefined;
    do {
      const list = await cfg.client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
      const objects = (list.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (objects.length) await cfg.client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: objects, Quiet: true } }));
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
  },

  async deleteKeys(bucket: Bucket, keys: string[]) {
    if (!keys.length) return;
    const cfg = await config();
    await cfg.client.send(
      new DeleteObjectsCommand({ Bucket: bucketName(cfg, bucket), Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }),
    );
  },

  publicUrl(assetsPublicUrl: string, key: string) {
    return `${assetsPublicUrl.replace(/\/+$/, '')}/${key}`;
  },

  async healthCheck() {
    const cfg = await config();
    await cfg.client.send(new HeadBucketCommand({ Bucket: cfg.mediaBucket }));
    await cfg.client.send(new HeadBucketCommand({ Bucket: cfg.assetsBucket }));
  },

  // ── Том видео файлыг browser-оос шууд R2 руу multipart upload хийх
  multipart: {
    async create(key: string, contentType: string) {
      const cfg = await config();
      const res = await cfg.client.send(new CreateMultipartUploadCommand({ Bucket: cfg.mediaBucket, Key: key, ContentType: contentType }));
      if (!res.UploadId) throw new Error('No UploadId returned');
      return res.UploadId;
    },
    async signParts(key: string, uploadId: string, partNumbers: number[]) {
      const cfg = await config();
      return Promise.all(
        partNumbers.map(async (PartNumber) => ({
          partNumber: PartNumber,
          url: await getSignedUrl(cfg.client, new UploadPartCommand({ Bucket: cfg.mediaBucket, Key: key, UploadId: uploadId, PartNumber }), {
            expiresIn: 3600,
          }),
        })),
      );
    },
    async complete(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]) {
      const cfg = await config();
      await cfg.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: cfg.mediaBucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts.sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
        }),
      );
    },
    async abort(key: string, uploadId: string) {
      const cfg = await config();
      await cfg.client.send(new AbortMultipartUploadCommand({ Bucket: cfg.mediaBucket, Key: key, UploadId: uploadId }));
    },
  },
};
