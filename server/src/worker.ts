import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { startSettingsSync } from './modules/settings/settings.service.js';
import { startWorkers } from './workers/index.js';

/**
 * Тусдаа background worker процесс — API-аас тусад нь ажиллаж, тусад нь scale хийгдэнэ.
 * (Туршилтын/жижиг орчинд RUN_WORKER=true тохируулж API дотор ажиллуулж болно.)
 */
const stopSettingsSync = startSettingsSync();
const stopWorkers = await startWorkers('standalone');

async function shutdown(signal: string) {
  logger.info({ signal }, 'Worker shutting down…');
  await stopWorkers();
  await Promise.allSettled([stopSettingsSync(), prisma.$disconnect(), redis.quit()]);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
