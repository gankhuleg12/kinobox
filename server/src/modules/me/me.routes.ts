import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate, input, idParam } from '../../middleware/validate.js';
import { entitlements } from '../access/entitlement.service.js';
import { settings } from '../settings/settings.service.js';
import { cardSelect, toCard } from '../catalog/catalog.mapper.js';
import { AppError } from '../../lib/errors.js';

/** Нэвтэрсэн хэрэглэгчийн хувийн мэдээлэл — хэзээ ч public cache хийгдэхгүй */
export const meRouter = Router();
meRouter.use(requireAuth, (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

meRouter.get('/movies/:id/access', validate({ params: idParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  const movie = await prisma.movie.findFirst({ where: { id: params.id, status: 'PUBLISHED' }, select: { id: true, accessType: true } });
  if (!movie) throw AppError.notFound('Кино олдсонгүй');
  const [access, progress] = await Promise.all([
    entitlements.check(req.auth!.userId, req.auth!.role, movie),
    prisma.watchProgress.findUnique({
      where: { userId_movieId: { userId: req.auth!.userId, movieId: movie.id } },
      select: { positionSec: true, durationSec: true, episodeId: true },
    }),
  ]);
  res.json({ access, progress });
});

meRouter.get('/continue-watching', async (req, res) => {
  const rows = await prisma.watchProgress.findMany({
    where: { userId: req.auth!.userId, movie: { status: 'PUBLISHED' } },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    select: { positionSec: true, durationSec: true, movie: { select: cardSelect } },
  });
  const base = await settings.get('r2.assetsPublicUrl');
  res.json(
    rows
      .filter((r) => !r.durationSec || r.positionSec < r.durationSec * 0.95)
      .map((r) => ({ ...toCard(r.movie, base), progress: { positionSec: r.positionSec, durationSec: r.durationSec } })),
  );
});

meRouter.get('/library', async (req, res) => {
  const userId = req.auth!.userId;
  const now = new Date();
  const [subscription, rentals, subscriptions] = await Promise.all([
    entitlements.summary(userId),
    prisma.rental.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, startsAt: true, expiresAt: true, movie: { select: cardSelect } },
    }),
    prisma.subscription.findMany({
      where: { userId },
      orderBy: { endsAt: 'desc' },
      take: 20,
      select: { id: true, status: true, startsAt: true, endsAt: true, plan: { select: { code: true, nameMn: true, nameEn: true } } },
    }),
  ]);
  const base = await settings.get('r2.assetsPublicUrl');
  res.json({
    subscription,
    subscriptions,
    rentals: rentals.map((r) => ({ id: r.id, startsAt: r.startsAt, expiresAt: r.expiresAt, active: r.expiresAt > now, movie: toCard(r.movie, base) })),
  });
});

const paymentsQuery = z.object({ page: z.coerce.number().int().min(1).max(500).default(1) });
meRouter.get('/payments', validate({ query: paymentsQuery }), async (req, res) => {
  const { query } = input<unknown, z.infer<typeof paymentsQuery>>(req);
  const take = 20;
  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where: { userId: req.auth!.userId },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * take,
      take,
      select: {
        id: true,
        type: true,
        amount: true,
        currency: true,
        status: true,
        createdAt: true,
        paidAt: true,
        movie: { select: { title: true, slug: true } },
        plan: { select: { nameMn: true, nameEn: true } },
      },
    }),
    prisma.payment.count({ where: { userId: req.auth!.userId } }),
  ]);
  res.json({ items, total, page: query.page, pages: Math.ceil(total / take) });
});

meRouter.get('/sessions', async (req, res) => {
  const sessions = await prisma.session.findMany({
    where: { userId: req.auth!.userId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, deviceName: true, ip: true, createdAt: true, lastSeenAt: true, revokedAt: true, revokeReason: true },
  });
  res.json(sessions.map((s) => ({ ...s, current: s.id === req.auth!.sessionId })));
});
