import { Worker } from 'bullmq';
import os from 'node:os';
import { run } from './modules/media/ffmpeg.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { redis, createBullConnection } from './lib/redis.js';
import { QUEUES, WORKER_HEARTBEAT_KEY, maintenanceQueue, type FacebookJob, type TranscodeJob } from './lib/queue.js';
import { startSettingsSync } from './modules/settings/settings.service.js';
import { runTranscode } from './jobs/transcode.job.js';
import { runMaintenance } from './jobs/maintenance.job.js';
import { processFacebookEvent } from './modules/facebook/bot.service.js';

/**
 * Background worker процесс — API-аас тусад нь ажиллаж, тусад нь scale хийгдэнэ.
 *   transcode   → ffmpeg HLS (CPU хүнд)
 *   facebook    → Messenger bot хариулт
 *   maintenance → хугацаа дууссан бичлэг цэвэрлэх
 */
const stopSettingsSync = startSettingsSync();

const workers = [
  new Worker<TranscodeJob>(QUEUES.transcode, runTranscode, {
    connection: createBullConnection('w-transcode'),
    concurrency: env.TRANSCODE_CONCURRENCY,
    lockDuration: 5 * 60_000,
  }),
  new Worker<FacebookJob>(QUEUES.facebook, (job) => processFacebookEvent(job.data), {
    connection: createBullConnection('w-facebook'),
    concurrency: 5,
    limiter: { max: 20, duration: 1000 }, // Graph API rate limit-ээс хамгаална
  }),
  new Worker(QUEUES.maintenance, () => runMaintenance(), {
    connection: createBullConnection('w-maintenance'),
    concurrency: 1,
  }),
];

for (const w of workers) {
  w.on('failed', (job, err) => logger.error({ queue: w.name, jobId: job?.id, err: err.message }, 'Job failed'));
  w.on('error', (err) => logger.error({ queue: w.name, err }, 'Worker error'));
}

await maintenanceQueue.upsertJobScheduler('maintenance-sweep', { every: 2 * 60_000 }, { name: 'sweep' });

// ── Heartbeat: Admin Panel worker ажиллаж байгаа эсэх, ffmpeg олдсон эсэхийг харна
async function checkBinary(bin: string) {
  try {
    const out = await run(bin, ['-hide_banner', '-version']);
    return { ok: true, version: out.split(/\r?\n/)[0]?.slice(0, 120) ?? '' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : String(err) };
  }
}
const tools = { ffmpeg: await checkBinary(env.FFMPEG_PATH), ffprobe: await checkBinary(env.FFPROBE_PATH) };
if (!tools.ffmpeg.ok || !tools.ffprobe.ok) {
  logger.error({ tools }, '❌ ffmpeg/ffprobe олдсонгүй — .env дахь FFMPEG_PATH, FFPROBE_PATH-ийг бүтэн замаар тохируулна уу');
}
const beat = () =>
  redis
    .set(WORKER_HEARTBEAT_KEY, JSON.stringify({ at: Date.now(), pid: process.pid, host: os.hostname(), ...tools }), 'EX', 45)
    .catch(() => undefined);
void beat();
const heartbeat = setInterval(beat, 15_000);

logger.info({ ffmpeg: tools.ffmpeg.ok, ffprobe: tools.ffprobe.ok }, '⚙️  KinoBox worker started');

async function shutdown(signal: string) {
  logger.info({ signal }, 'Worker shutting down…');
  clearInterval(heartbeat);
  await redis.del(WORKER_HEARTBEAT_KEY).catch(() => undefined);
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled([stopSettingsSync(), prisma.$disconnect(), redis.quit()]);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
