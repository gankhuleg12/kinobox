import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { r2 } from '../../lib/r2.js';
import { mailer } from '../../lib/mailer.js';
import { cache, CacheNs } from '../../lib/cache.js';
import { AppError } from '../../lib/errors.js';
import { validate, input, idParam, paginate } from '../../middleware/validate.js';
import { audit } from '../audit/audit.service.js';
import { settings } from '../settings/settings.service.js';
import { SETTING_GROUPS, isSettingKey, getDef } from '../settings/settings.registry.js';
import { providerByName } from '../payments/providers/index.js';
import { registerWireWebhook } from '../payments/providers/wire.provider.js';
import { redis } from '../../lib/redis.js';
import { transcodeQueue, WORKER_HEARTBEAT_KEY } from '../../lib/queue.js';
import { graphClient } from '../facebook/graph.client.js';
import { normalizeCode } from '../facebook/bot.service.js';

// ───────────── Dashboard статистик
export const statsAdmin = Router();

statsAdmin.get('/', async (_req, res) => {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const since30 = new Date(now.getTime() - 30 * 86_400_000);

  const [users, newUsers, activeSubs, pending, published, revenueToday, revenue30, byDay, topMovies, recent, fbSent] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: since30 } } }),
    prisma.subscription.count({ where: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } } }),
    prisma.payment.count({ where: { status: 'PENDING', expiresAt: { gt: now } } }),
    prisma.movie.count({ where: { status: 'PUBLISHED' } }),
    prisma.payment.aggregate({ where: { status: 'PAID', paidAt: { gte: dayStart } }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { status: 'PAID', paidAt: { gte: since30 } }, _sum: { amount: true }, _count: true }),
    prisma.$queryRaw<{ day: Date; total: unknown; cnt: unknown }[]>`
      SELECT DATE(paidAt) AS day, SUM(amount) AS total, COUNT(*) AS cnt
      FROM Payment WHERE status = 'PAID' AND paidAt >= ${since30}
      GROUP BY DATE(paidAt) ORDER BY day`,
    prisma.movie.findMany({ where: { status: 'PUBLISHED' }, orderBy: { viewCount: 'desc' }, take: 5, select: { id: true, title: true, viewCount: true } }),
    prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, amount: true, status: true, type: true, createdAt: true, user: { select: { email: true } } },
    }),
    prisma.fbBotEvent.count({ where: { status: 'SENT', createdAt: { gte: since30 } } }),
  ]);

  res.json({
    users,
    newUsers30d: newUsers,
    activeSubscriptions: activeSubs,
    pendingPayments: pending,
    publishedMovies: published,
    revenueToday: revenueToday._sum.amount ?? 0,
    revenue30d: revenue30._sum.amount ?? 0,
    paidCount30d: revenue30._count,
    fbMessages30d: fbSent,
    revenueByDay: byDay.map((r) => ({ day: new Date(r.day).toISOString().slice(0, 10), total: Number(r.total), count: Number(r.cnt) })),
    topMovies,
    recentPayments: recent,
  });
});

/** Worker процесс ажиллаж байгаа эсэх, ffmpeg олдсон эсэх, transcode дараалал */
statsAdmin.get('/worker', async (_req, res) => {
  const [raw, transcode] = await Promise.all([redis.get(WORKER_HEARTBEAT_KEY), transcodeQueue.getJobCounts('waiting', 'active', 'delayed', 'failed')]);
  const heartbeat = raw ? (JSON.parse(raw) as { at: number; ffmpeg: { ok: boolean; error?: string }; ffprobe: { ok: boolean; error?: string } }) : null;
  res.json({ online: Boolean(heartbeat), heartbeat, transcode });
});

/**
 * Reverse proxy-ийн ард TRUST_PROXY зөв эсэхийг шалгах: `ip` нь таны жинхэнэ IP байх ёстой.
 * Буруу бол rate limit бүх хэрэглэгчид нэг IP-ээр тоологдох эсвэл IP хуурамчаар солигдох эрсдэлтэй.
 */
statsAdmin.get('/whoami', (req, res) => {
  res.json({ ip: req.ip, ips: req.ips, forwardedFor: req.get('x-forwarded-for') ?? null, trustProxy: env.TRUST_PROXY });
});

// ───────────── API тохиргоо (secret-ууд хэзээ ч буцаагдахгүй)
export const settingsAdmin = Router();

/**
 * Wire.mn дээр webhook endpoint-ийг API-аар бүртгэж, буцсан signing secret-ийг
 * шифрлэн хадгална (secret зөвхөн үүсгэх үед нэг удаа ирдэг).
 */
settingsAdmin.post('/wire/register-webhook', async (req, res) => {
  const url = `${env.apiUrl}/api/webhooks/wire`;
  const host = new URL(url).hostname;
  if (host === 'localhost' || host.startsWith('127.') || host.endsWith('.local') || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host)) {
    throw AppError.badRequest(`Wire.mn нь localhost/дотоод хаяг руу webhook илгээдэггүй (${url}). API_URL-д public домэйн тохируулна уу. Webhook-гүйгээр polling-оор ажиллана.`);
  }
  const result = await registerWireWebhook(url);
  await settings.update({ 'wire.webhookSecret': result.secret }, [], req.auth!.userId);
  audit({ action: 'settings.wire.webhook_registered', entityType: 'settings', entityId: 'wire', meta: { url, endpointId: result.id, replaced: result.replaced }, req });
  res.json({ ok: true, url, status: result.status, replaced: result.replaced });
});

settingsAdmin.get('/', async (_req, res) => {
  res.json({
    groups: await settings.adminView(),
    meta: {
      wireWebhookUrl: `${env.apiUrl}/api/webhooks/wire`,
      facebookWebhookUrl: `${env.apiUrl}/api/webhooks/facebook`,
      googleRedirectUri: `${env.apiUrl}/api/auth/google/callback`,
      appUrl: env.appUrl,
      isProduction: env.isProd,
    },
  });
});

const updateBody = z.object({
  values: z.record(z.string().max(80), z.union([z.string().max(4000), z.number(), z.boolean()])).default({}),
  clear: z.array(z.string().max(80)).max(50).default([]),
});
settingsAdmin.put('/', validate({ body: updateBody }), async (req, res) => {
  const { body } = input<z.infer<typeof updateBody>>(req);
  if (env.isProd && body.values['payment.provider'] === 'mock') throw AppError.badRequest('Production орчинд mock провайдер ашиглах боломжгүй');
  for (const k of body.clear) if (isSettingKey(k) && !getDef(k).secret) throw AppError.badRequest(`${k}: зөвхөн secret утгыг устгана`);

  const changed = await settings.update(body.values, body.clear, req.auth!.userId);
  // Үнэ/багцын тохиргоо өөрчлөгдвөл catalog cache шинэчилнэ
  if (changed.some((k) => k.startsWith('pricing.') || k.startsWith('r2.') || k.startsWith('general.'))) {
    await cache.bump(CacheNs.catalog, CacheNs.plans);
  }
  // Утгыг БИШ, зөвхөн өөрчлөгдсөн key-ийн нэрийг audit-д бичнэ
  audit({ action: 'settings.update', entityType: 'settings', meta: { keys: changed }, req });
  res.json({ changed, groups: await settings.adminView() });
});

settingsAdmin.post('/test/:group', validate({ params: z.object({ group: z.enum(SETTING_GROUPS) }) }), async (req, res) => {
  const { params } = input<unknown, unknown, { group: (typeof SETTING_GROUPS)[number] }>(req);
  try {
    let detail: unknown = null;
    switch (params.group) {
      case 'r2':
        await r2.healthCheck();
        break;
      case 'smtp':
        await mailer.verify();
        break;
      case 'facebook':
        detail = await graphClient.healthCheck();
        break;
      case 'wire':
        await providerByName('wire').healthCheck?.();
        break;
      case 'google':
        await settings.require(['google.clientId', 'google.clientSecret'], 'Google OAuth');
        break;
      default:
        throw AppError.badRequest('Энэ бүлэгт тест байхгүй');
    }
    audit({ action: 'settings.test', entityType: 'settings', entityId: params.group, meta: { ok: true }, req });
    res.json({ ok: true, detail });
  } catch (err) {
    if (err instanceof AppError && err.status === 400) throw err;
    audit({ action: 'settings.test', entityType: 'settings', entityId: params.group, meta: { ok: false }, req });
    res.json({ ok: false, error: err instanceof Error ? err.message.slice(0, 300) : 'Алдаа' });
  }
});

// ───────────── Audit log
export const auditAdmin = Router();

const auditQuery = z.object({
  action: z.string().max(80).optional(),
  actorId: z.string().max(40).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
auditAdmin.get('/', validate({ query: auditQuery }), async (req, res) => {
  const { query } = input<unknown, z.infer<typeof auditQuery>>(req);
  const where: Prisma.AuditLogWhereInput = {
    ...(query.action ? { action: { startsWith: query.action } } : {}),
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, ...paginate(query.page, query.limit), include: { actor: { select: { name: true, email: true } } } }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ items: items.map((i) => ({ ...i, id: i.id.toString() })), total, page: query.page, pages: Math.ceil(total / query.limit) });
});

// ───────────── Facebook bot
export const facebookAdmin = Router();

facebookAdmin.get('/overview', async (_req, res) => {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [cfg, codes, stats] = await Promise.all([
    settings.getMany(['facebook.enabled', 'facebook.pageId', 'facebook.templateStyle']),
    prisma.movie.findMany({
      where: { fbCode: { not: null } },
      orderBy: { fbCode: 'asc' },
      select: { id: true, title: true, slug: true, fbCode: true, status: true, videoStatus: true },
    }),
    prisma.fbBotEvent.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
  ]);
  res.json({
    enabled: cfg['facebook.enabled'],
    pageId: cfg['facebook.pageId'],
    templateStyle: cfg['facebook.templateStyle'],
    webhookUrl: `${env.apiUrl}/api/webhooks/facebook`,
    codes,
    stats7d: Object.fromEntries(stats.map((s) => [s.status, s._count._all])),
  });
});

const eventsQuery = z.object({
  status: z.enum(['RECEIVED', 'SENT', 'NO_MATCH', 'SKIPPED', 'FAILED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
});
facebookAdmin.get('/events', validate({ query: eventsQuery }), async (req, res) => {
  const { query } = input<unknown, z.infer<typeof eventsQuery>>(req);
  const where = query.status ? { status: query.status } : {};
  const [items, total] = await Promise.all([
    prisma.fbBotEvent.findMany({ where, orderBy: { createdAt: 'desc' }, ...paginate(query.page, 30) }),
    prisma.fbBotEvent.count({ where }),
  ]);
  res.json({ items, total, page: query.page, pages: Math.ceil(total / 30) });
});

const codeBody = z.object({ fbCode: z.string().max(20).nullable() });
facebookAdmin.put('/codes/:id', validate({ params: idParam, body: codeBody }), async (req, res) => {
  const { params, body } = input<z.infer<typeof codeBody>, unknown, { id: string }>(req);
  const code = body.fbCode ? normalizeCode(body.fbCode) : null;
  if (code !== null && !/^[A-Z0-9_-]{1,20}$/.test(code)) throw AppError.badRequest('Код зөвхөн үсэг, тоо агуулна');
  const m = await prisma.movie.update({ where: { id: params.id }, data: { fbCode: code }, select: { id: true, fbCode: true } });
  audit({ action: 'facebook.code.set', entityType: 'movie', entityId: m.id, meta: { fbCode: code }, req });
  res.json(m);
});
