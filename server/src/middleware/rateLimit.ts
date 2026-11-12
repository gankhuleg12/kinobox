import { rateLimit, ipKeyGenerator, type Options } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { redis } from '../lib/redis.js';
import { AppError } from '../lib/errors.js';

function store(prefix: string) {
  const s = new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
  });
  // Эхлэх үед Redis бэлэн биш бол script ачаалалт reject болно. Store нь дараагийн хүсэлт дээр
  // script-ийг дахин ачаалдаг тул энд зөвхөн unhandled rejection-оос сэргийлнэ.
  const internals = s as unknown as Record<'incrementScriptSha' | 'getScriptSha', Promise<unknown> | undefined>;
  internals.incrementScriptSha?.catch(() => undefined);
  internals.getScriptSha?.catch(() => undefined);
  return s;
}

function limiter(name: string, windowMs: number, limit: number, extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: store(name),
    handler: (_req, _res, next) => {
      next(new AppError(429, 'RATE_LIMITED', 'Хэт олон хүсэлт илгээлээ. Түр хүлээгээд дахин оролдоно уу.'));
    },
    ...extra,
  });
}

/** Нэвтэрсэн бол userId-гаар, үгүй бол IP-гаар (IPv6 subnet-ийг зөв нэгтгэнэ) */
const userOrIp: NonNullable<Options['keyGenerator']> = (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? '0.0.0.0');

/**
 * IP + email: нэг аккаунт руу чиглэсэн brute force-ыг хязгаарлана, гэхдээ CGNAT-ийн ард
 * нэг IP-тэй олон хэрэглэгчийг хамтад нь хаахгүй (аккаунтын lockout нэмэлтээр ажиллана).
 */
const ipAndEmail: NonNullable<Options['keyGenerator']> = (req) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 191) : '';
  return `${ipKeyGenerator(req.ip ?? '0.0.0.0')}|${email}`;
};

/**
 * Нийтийн, уншлагын endpoint-ууд Redis түр унавал fail-open (үйлчилгээ зогсохгүй).
 * Auth, төлбөр, webhook зэрэг мэдрэмтгий endpoint-ууд fail-closed (хамгаалалт алдагдахгүй).
 */
export const rateLimits = {
  global: limiter('global', 60_000, 1000, { passOnStoreError: true }),
  /** IP-ийн ерөнхий хязгаар (credential stuffing, refresh spam) — CGNAT-д хангалттай өргөн */
  authIp: limiter('authip', 15 * 60_000, 300),
  /** Нэг аккаунт руу чиглэсэн оролдлого */
  login: limiter('login', 15 * 60_000, 10, { keyGenerator: ipAndEmail }),
  sensitive: limiter('sensitive', 15 * 60_000, 10, { keyGenerator: userOrIp }),
  register: limiter('register', 60 * 60_000, 30),
  passwordReset: limiter('pwreset', 60 * 60_000, 5, { keyGenerator: ipAndEmail }),
  search: limiter('search', 60_000, 60, { passOnStoreError: true }),
  checkout: limiter('checkout', 60 * 60_000, 30, { keyGenerator: userOrIp }),
  paymentStatus: limiter('paystatus', 60_000, 60, { keyGenerator: userOrIp }),
  playback: limiter('playback', 60_000, 300, { keyGenerator: userOrIp }),
  webhook: limiter('webhook', 60_000, 600),
  admin: limiter('admin', 60_000, 600, { keyGenerator: userOrIp }),
};
