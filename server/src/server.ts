import { createServer } from 'node:http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { createApp } from './app.js';
import { startSettingsSync } from './modules/settings/settings.service.js';

const app = createApp();
const server = createServer(app);
server.keepAliveTimeout = 65_000; // Load balancer-ийн idle timeout-оос урт байх ёстой
server.headersTimeout = 66_000;
server.requestTimeout = 120_000;

const stopSettingsSync = startSettingsSync();

server.listen(env.PORT, () => {
  logger.info(`🚀 KinoBox API → http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down gracefully…');
  const force = setTimeout(() => process.exit(1), 15_000).unref();
  server.close(async () => {
    await Promise.allSettled([stopSettingsSync(), prisma.$disconnect(), redis.quit()]);
    clearTimeout(force);
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled rejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  void shutdown('uncaughtException');
});
