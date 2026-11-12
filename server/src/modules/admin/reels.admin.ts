import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { r2 } from '../../lib/r2.js';
import { cache, CacheNs } from '../../lib/cache.js';
import { AppError } from '../../lib/errors.js';
import { validate, input, idParam, cleanText, paginate } from '../../middleware/validate.js';
import { audit } from '../audit/audit.service.js';
import { settings } from '../settings/settings.service.js';
import { videoUploadRouter } from './video-upload.js';

/** Reels (EDITOR+): босоо богино видео, кинотой холбогдоно */
export const reelsAdmin = Router();
const invalidate = () => cache.bump(CacheNs.catalog);

const reelBody = z.object({
  caption: cleanText(300).nullish(),
  movieId: idParam.shape.id.nullish(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  sortOrder: z.number().int().min(-10_000).max(10_000).optional(),
});
type ReelBody = z.infer<typeof reelBody>;

const listQuery = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

reelsAdmin.get('/', validate({ query: listQuery }), async (req, res) => {
  const { query } = input<unknown, z.infer<typeof listQuery>>(req);
  const where: Prisma.ReelWhereInput = query.status ? { status: query.status } : {};
  const [items, total, base] = await Promise.all([
    prisma.reel.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      ...paginate(query.page, query.limit),
      include: { movie: { select: { id: true, title: true, slug: true } } },
    }),
    prisma.reel.count({ where }),
    settings.get('r2.assetsPublicUrl'),
  ]);
  res.json({
    items: items.map(({ sourceKey: _s, videoKey, posterKey, ...r }) => ({
      ...r,
      video: base && videoKey ? `${base}/${videoKey}` : null,
      poster: base && posterKey ? `${base}/${posterKey}` : null,
    })),
    total,
    page: query.page,
    pages: Math.ceil(total / query.limit),
  });
});

async function ensureMovie(movieId: string | null | undefined) {
  if (!movieId) return;
  const exists = await prisma.movie.findUnique({ where: { id: movieId }, select: { id: true } });
  if (!exists) throw AppError.badRequest('Холбох кино олдсонгүй');
}

reelsAdmin.post('/', validate({ body: reelBody }), async (req, res) => {
  const { body } = input<ReelBody>(req);
  await ensureMovie(body.movieId);
  const reel = await prisma.reel.create({ data: { ...body, publishedAt: body.status === 'PUBLISHED' ? new Date() : null } });
  await invalidate();
  audit({ action: 'reel.create', entityType: 'reel', entityId: reel.id, req });
  res.status(201).json({ id: reel.id });
});

reelsAdmin.patch('/:id', validate({ params: idParam, body: reelBody.partial() }), async (req, res) => {
  const { params, body } = input<Partial<ReelBody>, unknown, { id: string }>(req);
  const before = await prisma.reel.findUnique({ where: { id: params.id }, select: { publishedAt: true } });
  if (!before) throw AppError.notFound();
  await ensureMovie(body.movieId);
  await prisma.reel.update({
    where: { id: params.id },
    data: { ...body, ...(body.status === 'PUBLISHED' && !before.publishedAt ? { publishedAt: new Date() } : {}) },
  });
  await invalidate();
  audit({ action: 'reel.update', entityType: 'reel', entityId: params.id, meta: { fields: Object.keys(body) }, req });
  res.json({ ok: true });
});

reelsAdmin.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  const reel = await prisma.reel.findUnique({ where: { id: params.id } });
  if (!reel) throw AppError.notFound();
  await prisma.reel.delete({ where: { id: reel.id } });
  await invalidate();
  audit({ action: 'reel.delete', entityType: 'reel', entityId: reel.id, req });
  void Promise.allSettled([r2.deletePrefix('assets', `reels/${reel.id}/`), r2.deletePrefix('media', `sources/reels/${reel.id}/`)]);
  res.status(204).end();
});

reelsAdmin.use('/:id/video', videoUploadRouter('reel'));
