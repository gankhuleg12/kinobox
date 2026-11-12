import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { validate, input, idParam, cleanString, paginate } from '../../middleware/validate.js';
import { audit } from '../audit/audit.service.js';
import { authService } from '../auth/auth.service.js';
import { entitlements } from '../access/entitlement.service.js';

// ───────────── Users (ADMIN)
export const usersAdmin = Router();

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(['USER', 'EDITOR', 'ADMIN']).optional(),
  status: z.enum(['ACTIVE', 'BANNED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
usersAdmin.get('/', validate({ query: listQuery }), async (req, res) => {
  const { query } = input<unknown, z.infer<typeof listQuery>>(req);
  const where: Prisma.UserWhereInput = {
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.q ? { OR: [{ email: { contains: query.q } }, { name: { contains: query.q } }, { id: query.q }] } : {}),
  };
  const now = new Date();
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...paginate(query.page, query.limit),
      select: {
        id: true, name: true, email: true, role: true, status: true, googleId: true, createdAt: true, lastLoginAt: true,
        subscriptions: { where: { status: 'ACTIVE', endsAt: { gt: now } }, select: { endsAt: true }, orderBy: { endsAt: 'desc' }, take: 1 },
      },
    }),
    prisma.user.count({ where }),
  ]);
  res.json({
    items: items.map(({ subscriptions, googleId, ...u }) => ({ ...u, google: Boolean(googleId), subscriptionEndsAt: subscriptions[0]?.endsAt ?? null })),
    total,
    page: query.page,
    pages: Math.ceil(total / query.limit),
  });
});

usersAdmin.get('/:id', validate({ params: idParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  const u = await prisma.user.findUnique({
    where: { id: params.id },
    select: {
      id: true, name: true, email: true, role: true, status: true, locale: true, googleId: true, createdAt: true,
      lastLoginAt: true, lastLoginIp: true, failedLogins: true, lockedUntil: true,
      sessions: { orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, deviceName: true, ip: true, createdAt: true, lastSeenAt: true, revokedAt: true, revokeReason: true } },
      subscriptions: { orderBy: { endsAt: 'desc' }, take: 20, include: { plan: { select: { nameMn: true, code: true } } } },
      rentals: { orderBy: { createdAt: 'desc' }, take: 20, include: { movie: { select: { title: true, slug: true } } } },
      payments: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, type: true, amount: true, status: true, createdAt: true, paidAt: true, source: true } },
    },
  });
  if (!u) throw AppError.notFound();
  const { googleId, ...rest } = u;
  res.json({ ...rest, google: Boolean(googleId) });
});

const patchBody = z.object({
  name: cleanString(100).pipe(z.string().min(2)).optional(),
  role: z.enum(['USER', 'EDITOR', 'ADMIN']).optional(),
  status: z.enum(['ACTIVE', 'BANNED']).optional(),
  unlock: z.boolean().optional(),
});
usersAdmin.patch('/:id', validate({ params: idParam, body: patchBody }), async (req, res) => {
  const { params, body } = input<z.infer<typeof patchBody>, unknown, { id: string }>(req);
  if (params.id === req.auth!.userId && (body.role || body.status)) {
    throw AppError.badRequest('Өөрийнхөө эрх, төлөвийг өөрчлөх боломжгүй');
  }
  const before = await prisma.user.findUnique({ where: { id: params.id }, select: { role: true, status: true } });
  if (!before) throw AppError.notFound();

  const { unlock, ...data } = body;
  const user = await prisma.user.update({
    where: { id: params.id },
    data: { ...data, ...(unlock ? { lockedUntil: null, failedLogins: 0 } : {}) },
    select: { id: true, role: true, status: true },
  });
  // Эрх эсвэл төлөв өөрчлөгдвөл JWT дахь role шинэчлэгдэхийн тулд session-уудыг хүчингүй болгоно
  if ((body.status === 'BANNED' && before.status !== 'BANNED') || (body.role && body.role !== before.role)) {
    await authService.revokeAllSessions(user.id, body.status === 'BANNED' ? 'BANNED' : 'ROLE_CHANGED');
  }
  audit({ action: 'user.update', entityType: 'user', entityId: user.id, meta: { before, after: { role: user.role, status: user.status }, unlock: Boolean(unlock) }, req });
  res.json(user);
});

usersAdmin.post('/:id/revoke-sessions', validate({ params: idParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  const count = await authService.revokeAllSessions(params.id, 'ADMIN_REVOKE');
  audit({ action: 'user.sessions_revoked', entityType: 'user', entityId: params.id, meta: { count }, req });
  res.json({ revoked: count });
});

const grantBody = z.object({ planId: z.number().int().positive(), days: z.number().int().min(1).max(3660).optional(), note: cleanString(255).optional() });
usersAdmin.post('/:id/grant-subscription', validate({ params: idParam, body: grantBody }), async (req, res) => {
  const { params, body } = input<z.infer<typeof grantBody>, unknown, { id: string }>(req);
  const plan = await prisma.plan.findUnique({ where: { id: body.planId } });
  if (!plan) throw AppError.notFound('Багц олдсонгүй');
  const lastEnd = await entitlements.subscriptionEndsAt(params.id);
  const startsAt = lastEnd ?? new Date();
  const sub = await prisma.subscription.create({
    data: {
      userId: params.id,
      planId: plan.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + (body.days ?? plan.durationDays) * 86_400_000),
      note: body.note ?? `Admin олгосон`,
    },
  });
  await entitlements.invalidate(params.id);
  audit({ action: 'subscription.grant', entityType: 'subscription', entityId: sub.id, meta: { userId: params.id, planId: plan.id, days: body.days ?? plan.durationDays }, req });
  res.status(201).json(sub);
});

// ───────────── Subscriptions (ADMIN)
export const subscriptionsAdmin = Router();

const subListQuery = z.object({
  status: z.enum(['ACTIVE', 'CANCELED', 'EXPIRED']).optional(),
  activeOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
subscriptionsAdmin.get('/', validate({ query: subListQuery }), async (req, res) => {
  const { query } = input<unknown, z.infer<typeof subListQuery>>(req);
  const now = new Date();
  const where: Prisma.SubscriptionWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.activeOnly ? { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } } : {}),
    ...(query.q ? { user: { OR: [{ email: { contains: query.q } }, { name: { contains: query.q } }] } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...paginate(query.page, query.limit),
      include: { user: { select: { id: true, name: true, email: true } }, plan: { select: { nameMn: true, code: true, price: true } } },
    }),
    prisma.subscription.count({ where }),
  ]);
  res.json({ items, total, page: query.page, pages: Math.ceil(total / query.limit) });
});

const subPatch = z.object({ status: z.enum(['ACTIVE', 'CANCELED']).optional(), endsAt: z.coerce.date().optional(), note: cleanString(255).optional() });
subscriptionsAdmin.patch('/:id', validate({ params: idParam, body: subPatch }), async (req, res) => {
  const { params, body } = input<z.infer<typeof subPatch>, unknown, { id: string }>(req);
  const sub = await prisma.subscription.update({
    where: { id: params.id },
    data: { ...body, ...(body.status === 'CANCELED' && !body.endsAt ? { endsAt: new Date() } : {}) },
  });
  await entitlements.invalidate(sub.userId);
  audit({ action: 'subscription.update', entityType: 'subscription', entityId: sub.id, meta: { ...body, endsAt: body.endsAt?.toISOString() }, req });
  res.json(sub);
});
