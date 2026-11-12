import { redis } from './redis.js';
import { logger } from './logger.js';

/**
 * Redis JSON cache, namespace-ийн version-оор invalidation хийнэ.
 * `bump('catalog')` дуудахад тухайн namespace-ийн бүх key шууд хүчингүй болно
 * (KEYS/SCAN хийх шаардлагагүй, O(1)).
 */
const PREFIX = 'cache';
const inflight = new Map<string, Promise<unknown>>();

async function nsVersion(ns: string): Promise<string> {
  return (await redis.get(`${PREFIX}:ver:${ns}`)) ?? '0';
}

export const cache = {
  async wrap<T>(ns: string, key: string, ttlSec: number, loader: () => Promise<T>): Promise<T> {
    let fullKey: string;
    try {
      fullKey = `${PREFIX}:${ns}:${await nsVersion(ns)}:${key}`;
      const hit = await redis.get(fullKey);
      if (hit !== null) return JSON.parse(hit) as T;
    } catch (err) {
      logger.warn({ err }, 'cache read failed — falling back to loader');
      return loader();
    }

    // Нэг процесс дотор ижил key-г зэрэг ачаалахаас сэргийлнэ (cache stampede)
    const existing = inflight.get(fullKey);
    if (existing) return existing as Promise<T>;

    const p = (async () => {
      try {
        const value = await loader();
        redis.set(fullKey, JSON.stringify(value), 'EX', ttlSec).catch((err) => logger.warn({ err }, 'cache write failed'));
        return value;
      } finally {
        inflight.delete(fullKey);
      }
    })();
    inflight.set(fullKey, p);
    return p;
  },

  async bump(...namespaces: string[]) {
    await Promise.all(namespaces.map((ns) => redis.incr(`${PREFIX}:ver:${ns}`)));
  },

  async del(key: string) {
    await redis.del(key);
  },
};

export const CacheNs = {
  catalog: 'catalog',
  plans: 'plans',
  entitlement: (userId: string) => `ent:${userId}`,
} as const;
