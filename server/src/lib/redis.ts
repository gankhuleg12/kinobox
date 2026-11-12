import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

function create(name: string, opts: { forBullmq?: boolean } = {}) {
  const client = new Redis(env.REDIS_URL, {
    connectionName: `kinobox:${name}`,
    // BullMQ blocking холболтод null байх шаардлагатай
    maxRetriesPerRequest: opts.forBullmq ? null : 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  client.on('error', (err) => logger.error({ err, name }, 'Redis error'));
  return client;
}

/** Ерөнхий cache / rate limit / session холболт */
export const redis = create('main');

/** BullMQ queue/worker-д зориулсан холболт үүсгэгч */
export const createBullConnection = (name: string) => create(name, { forBullmq: true });

/** Pub/Sub subscriber (тусдаа холболт шаардлагатай) */
export const createSubscriber = (name: string) => create(name);
