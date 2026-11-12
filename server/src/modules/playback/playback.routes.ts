import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { r2 } from '../../lib/r2.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { decrypt } from '../../lib/crypto.js';
import { signPlaybackToken, verifyPlaybackToken } from '../../lib/jwt.js';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimits } from '../../middleware/rateLimit.js';
import { validate, input, idParam } from '../../middleware/validate.js';
import { sessionStore } from '../auth/session.store.js';
import { entitlements } from '../access/entitlement.service.js';
import { settings } from '../settings/settings.service.js';
import { rewriteMaster, rewriteVariant, applyToken, isSafeRendition } from './hls.js';

export const playbackRouter = Router();
const encKey = Buffer.from(env.SETTINGS_ENCRYPTION_KEY, 'base64');

// HLS мэдээллийг процесс дотор богино хугацаанд cache хийнэ (segment/key хүсэлт олон тул)
type MediaKind = 'movie' | 'episode';
const hlsInfoCache = new Map<string, { at: number; info: { hlsPath: string; hlsKeyEnc: string } | null }>();
async function hlsInfo(kind: MediaKind, id: string) {
  const cacheKey = `${kind}:${id}`;
  const hit = hlsInfoCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 60_000) return hit.info;
  const select = { hlsPath: true, hlsKeyEnc: true, videoStatus: true } as const;
  const m = kind === 'movie' ? await prisma.movie.findUnique({ where: { id }, select }) : await prisma.episode.findUnique({ where: { id }, select });
  const info = m?.videoStatus === 'READY' && m.hlsPath && m.hlsKeyEnc ? { hlsPath: m.hlsPath, hlsKeyEnc: m.hlsKeyEnc } : null;
  if (hlsInfoCache.size > 5000) hlsInfoCache.clear();
  hlsInfoCache.set(cacheKey, { at: Date.now(), info });
  return info;
}

async function authorize(mediaId: string, token: unknown) {
  if (typeof token !== 'string' || token.length > 2000) throw AppError.unauthorized();
  const claims = await verifyPlaybackToken(token);
  if (claims.mid !== mediaId) throw AppError.forbidden();
  if (!(await sessionStore.isActive(claims.sid, claims.sub))) {
    throw AppError.unauthorized('Таны аккаунт өөр төхөөрөмжөөс нэвтэрсэн байна', 'SESSION_REVOKED');
  }
  const info = await hlsInfo(claims.kind, mediaId);
  if (!info) throw new AppError(409, 'VIDEO_NOT_READY', 'Видео бэлэн болоогүй байна');
  return { claims, info, token };
}

function sendPlaylist(res: Response, body: string) {
  res.set({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'private, no-store' }).send(body);
}

async function cachedText(key: string, ttl: number, load: () => Promise<string>) {
  const hit = await redis.get(key);
  if (hit !== null) return hit;
  const value = await load();
  await redis.set(key, value, 'EX', ttl);
  return value;
}

/** Үзэлтийн тоо: хэрэглэгч бүр кино бүрт өдөрт нэг л удаа тоологдоно */
async function countView(movieId: string, userId: string) {
  const day = new Date().toISOString().slice(0, 10);
  if (await redis.set(`view:${movieId}:${userId}:${day}`, '1', 'EX', 86_400, 'NX')) {
    prisma.movie.update({ where: { id: movieId }, data: { viewCount: { increment: 1 } } }).catch(() => undefined);
  }
}

function sessionResponse(mediaId: string, token: string, extra: Record<string, unknown>) {
  return {
    manifestUrl: `/api/playback/${mediaId}/master.m3u8?t=${encodeURIComponent(token)}`,
    expiresIn: env.PLAYBACK_TOKEN_TTL_SEC,
    heartbeatSec: 30,
    ...extra,
  };
}

// ── Кино тоглуулах session
playbackRouter.post('/:id/session', requireAuth, rateLimits.playback, validate({ params: idParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  const { userId, sessionId, role } = req.auth!;
  const isStaff = role === 'ADMIN' || role === 'EDITOR';

  const movie = await prisma.movie.findFirst({
    where: { id: params.id, ...(isStaff ? {} : { status: 'PUBLISHED' }) },
    select: { id: true, kind: true, accessType: true, videoStatus: true, durationSec: true },
  });
  if (!movie) throw AppError.notFound('Кино олдсонгүй');
  if (movie.kind === 'SERIES') throw AppError.badRequest('Цувралын ангиа сонгоно уу');
  if (movie.videoStatus !== 'READY') throw new AppError(409, 'VIDEO_NOT_READY', 'Видео бэлэн болоогүй байна');

  const access = await entitlements.check(userId, role, movie);
  if (!access.allowed) throw AppError.forbidden('Энэ киног үзэх эрх байхгүй байна', 'NOT_ENTITLED');

  const token = await signPlaybackToken({ sub: userId, sid: sessionId, mid: movie.id, kind: 'movie' });
  const progress = await prisma.watchProgress.findUnique({ where: { userId_movieId: { userId, movieId: movie.id } }, select: { positionSec: true } });
  await countView(movie.id, userId);

  res.set('Cache-Control', 'private, no-store').json(sessionResponse(movie.id, token, { resumeAt: progress?.positionSec ?? 0, durationSec: movie.durationSec, access }));
});

// ── Цувралын анги тоглуулах session
const episodeSelect = { id: true, movieId: true, seasonNumber: true, episodeNumber: true, title: true, titleEn: true, durationSec: true } as const;

playbackRouter.post('/episodes/:id/session', requireAuth, rateLimits.playback, validate({ params: idParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  const { userId, sessionId, role } = req.auth!;
  const isStaff = role === 'ADMIN' || role === 'EDITOR';

  const episode = await prisma.episode.findFirst({
    where: { id: params.id, ...(isStaff ? {} : { isPublished: true, movie: { status: 'PUBLISHED' } }) },
    select: { ...episodeSelect, videoStatus: true, movie: { select: { id: true, accessType: true, freeEpisodes: true } } },
  });
  if (!episode) throw AppError.notFound('Анги олдсонгүй');
  if (episode.videoStatus !== 'READY') throw new AppError(409, 'VIDEO_NOT_READY', 'Видео бэлэн болоогүй байна');

  const access = await entitlements.checkEpisode(userId, role, episode.movie, episode);
  if (!access.allowed) throw AppError.forbidden('Энэ ангийг үзэх эрх байхгүй байна', 'NOT_ENTITLED');

  const [progress, next] = await Promise.all([
    prisma.watchProgress.findUnique({ where: { userId_movieId: { userId, movieId: episode.movieId } }, select: { positionSec: true, episodeId: true } }),
    // Дараагийн нийтлэгдсэн анги (улирал дамжина)
    prisma.episode.findFirst({
      where: {
        movieId: episode.movieId,
        isPublished: true,
        OR: [{ seasonNumber: episode.seasonNumber, episodeNumber: { gt: episode.episodeNumber } }, { seasonNumber: { gt: episode.seasonNumber } }],
      },
      orderBy: [{ seasonNumber: 'asc' }, { episodeNumber: 'asc' }],
      select: episodeSelect,
    }),
  ]);
  const token = await signPlaybackToken({ sub: userId, sid: sessionId, mid: episode.id, kind: 'episode' });
  await countView(episode.movieId, userId);

  const { movie: _m, videoStatus: _v, ...current } = episode;
  res.set('Cache-Control', 'private, no-store').json(
    sessionResponse(episode.id, token, {
      resumeAt: progress?.episodeId === episode.id ? progress.positionSec : 0,
      durationSec: episode.durationSec,
      access,
      episode: current,
      next,
    }),
  );
});

// ── Master playlist
playbackRouter.get('/:id/master.m3u8', rateLimits.playback, validate({ params: idParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  const { info, token } = await authorize(params.id, req.query.t);
  const master = await cachedText(`hls:m:${info.hlsPath}`, 86_400, () => r2.getText('media', `${info.hlsPath}/master.m3u8`));
  sendPlaylist(res, rewriteMaster(master, token));
});

// ── Variant playlist (segment-үүд presigned URL болно)
playbackRouter.get('/:id/v/:rendition.m3u8', rateLimits.playback, async (req, res) => {
  const params = z.object({ id: idParam.shape.id, rendition: z.string() }).parse(req.params);
  if (!isSafeRendition(params.rendition)) throw AppError.badRequest();
  const { info, token } = await authorize(params.id, req.query.t);

  const ttl = await settings.get('r2.segmentUrlTtlSec');
  // Presigned URL-ууд хэрэглэгчээс хамааралгүй → TTL-ийн хагас хугацаанд cache хийнэ
  const rewritten = await cachedText(`hls:v:${info.hlsPath}:${params.rendition}`, Math.floor(ttl / 2), async () => {
    const raw = await r2.getText('media', `${info.hlsPath}/${params.rendition}/index.m3u8`);
    return rewriteVariant(raw, (file) => r2.presignGet(`${info.hlsPath}/${params.rendition}/${file}`, ttl));
  });
  sendPlaylist(res, applyToken(rewritten, token));
});

// ── AES-128 түлхүүр
playbackRouter.get('/:id/key', rateLimits.playback, validate({ params: idParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  const { info } = await authorize(params.id, req.query.t);
  const key = Buffer.from(decrypt(info.hlsKeyEnc, encKey), 'base64');
  res.set({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, no-store' }).send(key);
});

// ── Heartbeat: үзэж буй байрлал хадгалах + session идэвхтэй эсэхийг шалгах
const heartbeatBody = z.object({
  movieId: idParam.shape.id,
  episodeId: idParam.shape.id.optional(),
  positionSec: z.number().int().min(0).max(86_400),
  durationSec: z.number().int().min(0).max(86_400).optional(),
});
playbackRouter.post('/heartbeat', requireAuth, rateLimits.playback, validate({ body: heartbeatBody }), async (req, res) => {
  const { body } = input<z.infer<typeof heartbeatBody>>(req);
  const userId = req.auth!.userId;
  await prisma.watchProgress.upsert({
    where: { userId_movieId: { userId, movieId: body.movieId } },
    create: { userId, movieId: body.movieId, episodeId: body.episodeId ?? null, positionSec: body.positionSec, durationSec: body.durationSec },
    update: { episodeId: body.episodeId ?? null, positionSec: body.positionSec, durationSec: body.durationSec },
  });
  res.set('Cache-Control', 'no-store').json({ ok: true });
});
