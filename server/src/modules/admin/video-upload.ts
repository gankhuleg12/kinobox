import { Router } from 'express';
import { z } from 'zod';
import { redis } from '../../lib/redis.js';
import { r2 } from '../../lib/r2.js';
import { AppError } from '../../lib/errors.js';
import { randomToken } from '../../lib/crypto.js';
import { transcodeQueue, safeJobId } from '../../lib/queue.js';
import { validate, input, idParam } from '../../middleware/validate.js';
import { audit } from '../audit/audit.service.js';
import { mediaRepo, type MediaType } from '../media/media.repo.js';

/**
 * Видео upload: browser → R2 шууд multipart (сервер дундуур дамжихгүй).
 * Кино, цувралын анги, reel гурвуулаа ашиглана. Эцэг router-т `/:id/video` дээр холбогдоно.
 */
const VIDEO_EXT = new Set(['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v']);
const MAX_BYTES: Record<MediaType, number> = { movie: 60 * 1024 ** 3, episode: 30 * 1024 ** 3, reel: 2 * 1024 ** 3 };
const MB = 1024 * 1024;

const uploadKey = (uploadId: string) => `upload:${uploadId}`;
const pendingSchema = z.object({ type: z.enum(['movie', 'episode', 'reel']), id: z.string(), key: z.string(), partCount: z.number() });

const initBody = z.object({
  fileName: z.string().max(255),
  size: z.number().int().positive(),
  contentType: z.string().regex(/^video\/[a-z0-9.+-]+$/i, 'Видео файл сонгоно уу'),
});
const signBody = z.object({ uploadId: z.string().max(1024), partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(100) });
const completeBody = z.object({
  uploadId: z.string().max(1024),
  parts: z.array(z.object({ partNumber: z.number().int().min(1).max(10_000), etag: z.string().max(200) })).min(1).max(10_000),
});

async function enqueue(type: MediaType, id: string, sourceKey: string) {
  await transcodeQueue.add('transcode', { type, id, sourceKey }, { jobId: safeJobId('transcode', type, id, randomToken(4)) });
}

export function videoUploadRouter(type: MediaType) {
  const router = Router({ mergeParams: true });
  const params = idParam;

  async function load(id: string) {
    const media = await mediaRepo.get(type, id);
    if (!media) throw AppError.notFound();
    return media;
  }

  async function pending(uploadId: string, id: string) {
    const raw = await redis.get(uploadKey(uploadId));
    if (!raw) throw AppError.badRequest('Upload session олдсонгүй эсвэл хугацаа дууссан');
    const data = pendingSchema.parse(JSON.parse(raw));
    if (data.type !== type || data.id !== id) throw AppError.forbidden();
    return data;
  }

  router.post('/init', validate({ params, body: initBody }), async (req, res) => {
    const { params: p, body } = input<z.infer<typeof initBody>, unknown, { id: string }>(req);
    const media = await load(p.id);
    if (media.isSeries) throw AppError.badRequest('Цувралын видеог анги бүр дээр тусад нь upload хийнэ');
    if (body.size > MAX_BYTES[type]) throw AppError.badRequest(`Файлын хэмжээ ${Math.round(MAX_BYTES[type] / 1024 ** 3)}GB-аас ихгүй байна`);

    const ext = body.fileName.split('.').pop()?.toLowerCase() ?? '';
    if (!VIDEO_EXT.has(ext)) throw AppError.badRequest(`Зөвшөөрөгдөх өргөтгөл: ${[...VIDEO_EXT].join(', ')}`);

    const partSize = Math.max(16 * MB, Math.ceil(body.size / 9_000 / MB) * MB);
    const partCount = Math.ceil(body.size / partSize);
    const key = `${media.sourcePrefix}/${randomToken(8)}.${ext}`;
    const uploadId = await r2.multipart.create(key, body.contentType);

    await redis.set(uploadKey(uploadId), JSON.stringify({ type, id: media.id, key, partCount }), 'EX', 24 * 3600);
    await mediaRepo.update(type, media.id, { videoStatus: 'UPLOADING', videoProgress: 0, videoError: null });
    audit({ action: `${type}.video.upload_started`, entityType: type, entityId: media.id, meta: { size: body.size }, req });
    res.json({ uploadId, key, partSize, partCount });
  });

  router.post('/sign', validate({ params, body: signBody }), async (req, res) => {
    const { params: p, body } = input<z.infer<typeof signBody>, unknown, { id: string }>(req);
    const up = await pending(body.uploadId, p.id);
    if (body.partNumbers.some((n) => n > up.partCount)) throw AppError.badRequest('Part дугаар буруу');
    res.json({ urls: await r2.multipart.signParts(up.key, body.uploadId, body.partNumbers) });
  });

  router.post('/complete', validate({ params, body: completeBody }), async (req, res) => {
    const { params: p, body } = input<z.infer<typeof completeBody>, unknown, { id: string }>(req);
    const up = await pending(body.uploadId, p.id);
    if (body.parts.length !== up.partCount) throw AppError.badRequest('Бүх part upload хийгдээгүй байна');

    await r2.multipart.complete(up.key, body.uploadId, body.parts);
    await redis.del(uploadKey(body.uploadId));

    const media = await load(p.id);
    await mediaRepo.update(type, media.id, { sourceKey: up.key, videoStatus: 'QUEUED', videoProgress: 0, videoError: null });
    await enqueue(type, media.id, up.key);
    if (media.sourceKey && media.sourceKey !== up.key) void r2.deleteKeys('media', [media.sourceKey]).catch(() => undefined);

    audit({ action: `${type}.video.uploaded`, entityType: type, entityId: media.id, req });
    res.json({ ok: true, videoStatus: 'QUEUED' });
  });

  router.post('/abort', validate({ params, body: z.object({ uploadId: z.string().max(1024) }) }), async (req, res) => {
    const { params: p, body } = input<{ uploadId: string }, unknown, { id: string }>(req);
    const up = await pending(body.uploadId, p.id);
    await r2.multipart.abort(up.key, body.uploadId).catch(() => undefined);
    await redis.del(uploadKey(body.uploadId));
    const media = await load(p.id);
    await mediaRepo.update(type, media.id, { videoStatus: media.hasOutput ? 'READY' : 'NONE', videoProgress: media.hasOutput ? 100 : 0 });
    res.json({ ok: true });
  });

  router.post('/retranscode', validate({ params }), async (req, res) => {
    const { params: p } = input<unknown, unknown, { id: string }>(req);
    const media = await load(p.id);
    if (!media.sourceKey) throw AppError.badRequest('Эх видео файл байхгүй байна');
    if (media.videoStatus === 'PROCESSING' || media.videoStatus === 'QUEUED') throw AppError.conflict('Видео боловсруулагдаж байна');
    await mediaRepo.update(type, media.id, { videoStatus: 'QUEUED', videoProgress: 0, videoError: null });
    await enqueue(type, media.id, media.sourceKey);
    audit({ action: `${type}.video.retranscode`, entityType: type, entityId: media.id, req });
    res.json({ ok: true });
  });

  return router;
}
