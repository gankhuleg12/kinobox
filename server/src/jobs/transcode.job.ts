import type { Job } from 'bullmq';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import sharp from 'sharp';
import type { Prisma } from '@prisma/client';
import { r2 } from '../lib/r2.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { encrypt, randomToken } from '../lib/crypto.js';
import { cache, CacheNs } from '../lib/cache.js';
import type { TranscodeJob } from '../lib/queue.js';
import { buildHlsArgs, buildReelArgs, buildThumbnailArgs, parseProbe, run, selectLadder, REEL_MAX_SECONDS, type ProbeResult } from '../modules/media/ffmpeg.js';
import { mediaRepo, type MediaRecord } from '../modules/media/media.repo.js';

const encKey = Buffer.from(env.SETTINGS_ENCRYPTION_KEY, 'base64');
const CONTENT_TYPES: Record<string, string> = { '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.m4s': 'video/iso.segment', '.mp4': 'video/mp4' };
const IMMUTABLE = 'public, max-age=31536000, immutable';

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name)) : Promise.resolve([path.join(dir, e.name)]))));
  return nested.flat();
}

async function uploadDir(localDir: string, prefix: string, concurrency = 8) {
  const files = await listFiles(localDir);
  let i = 0;
  const worker = async () => {
    while (i < files.length) {
      const file = files[i++]!;
      const rel = path.relative(localDir, file).split(path.sep).join('/');
      const ext = path.extname(file);
      const { size } = await stat(file);
      await r2.put(
        'media',
        `${prefix}/${rel}`,
        createReadStream(file),
        CONTENT_TYPES[ext] ?? 'application/octet-stream',
        ext === '.ts' ? 'private, max-age=31536000, immutable' : 'private, no-cache',
        size,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return files.length;
}

/** ffmpeg-ийн `-progress pipe:1` гаралтаас хувь тооцоолж мэдээлнэ */
function progressReporter(durationSec: number, from: number, to: number, report: (pct: number) => void) {
  let buffer = '';
  let last = from;
  return (chunk: string) => {
    buffer += chunk;
    const value = [...buffer.matchAll(/out_time_us=(\d+)/g)].at(-1)?.[1];
    buffer = buffer.slice(-200);
    if (!value || !durationSec) return;
    const pct = Math.min(to, from + Math.floor((Number(value) / 1e6 / durationSec) * (to - from)));
    if (pct >= last + 3) {
      last = pct;
      report(pct);
    }
  };
}

type Ctx = { job: Job<TranscodeJob>; media: MediaRecord; input: string; probe: ProbeResult; work: string; setProgress: (p: number) => void };

/** Кино / анги → AES-128 шифрлэгдсэн adaptive HLS (private media bucket) */
async function transcodeHls({ job, media, input, probe, work, setProgress }: Ctx) {
  const ladder = selectLadder(probe.height);
  const key = crypto.randomBytes(16);
  const keyPath = path.join(work, 'enc.key');
  const keyInfoPath = path.join(work, 'enc.keyinfo');
  await writeFile(keyPath, key);
  await writeFile(keyInfoPath, `key.bin\n${keyPath}\n${crypto.randomBytes(16).toString('hex')}\n`);

  const outDir = path.join(work, 'out');
  await mkdir(outDir);
  for (const r of ladder) await mkdir(path.join(outDir, r.name));

  await run(
    env.FFMPEG_PATH,
    buildHlsArgs({ input, outDir, ladder, hasAudio: probe.hasAudio, keyInfoPath }),
    progressReporter(probe.durationSec, 5, 90, (p) => (setProgress(p), void job.updateProgress(p))),
  );
  // Түлхүүр R2-д хэзээ ч очихгүй — зөвхөн шифрлэгдсэн хэлбэрээр DB-д
  await rm(keyPath, { force: true });

  const hlsPath = `${media.storagePrefix}/hls/${randomToken(6)}`;
  const count = await uploadDir(outDir, hlsPath);
  setProgress(98);

  await mediaRepo.setHls(media.type as 'movie' | 'episode', media.id, {
    hlsPath,
    hlsKeyEnc: encrypt(key.toString('base64'), encKey),
    durationSec: probe.durationSec || media.durationSec,
    renditions: ladder.map((r) => ({ name: r.name, height: r.height })) as Prisma.InputJsonValue,
  });
  logger.info({ type: media.type, id: media.id, renditions: ladder.map((r) => r.name), files: count }, 'HLS transcode complete');

  if (media.hlsPath && media.hlsPath !== hlsPath) {
    await r2.deletePrefix('media', `${media.hlsPath}/`).catch((err) => logger.warn({ err }, 'Old HLS cleanup failed'));
  }
}

/** Reel → нэг MP4 + WebP poster (public assets bucket, CDN) */
async function transcodeReel({ job, media, input, probe, work, setProgress }: Ctx) {
  const output = path.join(work, 'reel.mp4');
  const duration = Math.min(probe.durationSec || REEL_MAX_SECONDS, REEL_MAX_SECONDS);
  await run(
    env.FFMPEG_PATH,
    buildReelArgs({ input, output, hasAudio: probe.hasAudio }),
    progressReporter(duration, 5, 85, (p) => (setProgress(p), void job.updateProgress(p))),
  );

  const out = parseProbe(await run(env.FFPROBE_PATH, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', output]));
  const jpg = path.join(work, 'poster.jpg');
  await run(env.FFMPEG_PATH, buildThumbnailArgs(output, jpg, Math.min(1, out.durationSec / 3)));
  const poster = await sharp(await readFile(jpg)).resize({ width: 540, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();

  const base = `${media.storagePrefix}/${randomToken(6)}`;
  const { size } = await stat(output);
  await r2.put('assets', `${base}.mp4`, createReadStream(output), 'video/mp4', IMMUTABLE, size);
  await r2.put('assets', `${base}.webp`, poster, 'image/webp', IMMUTABLE, poster.length);
  setProgress(98);

  await mediaRepo.setReel(media.id, { videoKey: `${base}.mp4`, posterKey: `${base}.webp`, durationSec: out.durationSec, width: out.width, height: out.height });
  logger.info({ id: media.id, width: out.width, height: out.height }, 'Reel transcode complete');

  const old = [media.videoKey, media.posterKey].filter((k): k is string => Boolean(k));
  if (old.length) await r2.deleteKeys('assets', old).catch((err) => logger.warn({ err }, 'Old reel cleanup failed'));
}

export async function runTranscode(job: Job<TranscodeJob>) {
  const { type, id, sourceKey } = job.data;
  const media = await mediaRepo.get(type, id);
  if (!media || media.sourceKey !== sourceKey) {
    logger.warn({ type, id }, 'Transcode skipped: record missing or source changed');
    return;
  }

  const work = await mkdtemp(path.join(env.TRANSCODE_TMP_DIR ?? os.tmpdir(), 'kb-transcode-'));
  const setProgress = (videoProgress: number) => void mediaRepo.update(type, id, { videoProgress }).catch(() => undefined);

  try {
    await mediaRepo.update(type, id, { videoStatus: 'PROCESSING', videoProgress: 0, videoError: null });

    const input = path.join(work, `source${path.extname(sourceKey) || '.mp4'}`);
    await r2.download('media', sourceKey, input);
    setProgress(5);

    const probe = parseProbe(
      await run(env.FFPROBE_PATH, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', input]),
    );

    const ctx: Ctx = { job, media, input, probe, work, setProgress };
    if (type === 'reel') await transcodeReel(ctx);
    else await transcodeHls(ctx);

    await cache.bump(CacheNs.catalog);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, type, id }, 'Transcode failed');
    const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await mediaRepo.update(type, id, final ? { videoStatus: 'FAILED', videoError: message.slice(0, 500) } : { videoStatus: 'QUEUED', videoError: `Retrying: ${message.slice(0, 480)}` });
    throw err;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}
