import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { cache, CacheNs } from '../../lib/cache.js';
import { AppError } from '../../lib/errors.js';
import { requireRole } from '../../middleware/auth.js';
import { validate, input, intIdParam, cleanString, slugSchema } from '../../middleware/validate.js';
import { audit } from '../audit/audit.service.js';
import { slugify } from './slug.js';

// ───────────── Categories (EDITOR+)
export const categoriesAdmin = Router();

const categoryBody = z.object({
  nameMn: cleanString(100).pipe(z.string().min(1)),
  nameEn: cleanString(100).pipe(z.string().min(1)),
  slug: slugSchema.optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
  showOnHome: z.boolean().optional(),
});
type CategoryBody = z.infer<typeof categoryBody>;

categoriesAdmin.get('/', async (_req, res) => {
  const rows = await prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { _count: { select: { movies: true } } } });
  res.json(rows.map(({ _count, ...c }) => ({ ...c, movieCount: _count.movies })));
});

categoriesAdmin.post('/', validate({ body: categoryBody }), async (req, res) => {
  const { body } = input<CategoryBody>(req);
  const c = await prisma.category.create({ data: { ...body, slug: body.slug ?? slugify(body.nameEn || body.nameMn) } });
  await cache.bump(CacheNs.catalog);
  audit({ action: 'category.create', entityType: 'category', entityId: c.id, req });
  res.status(201).json(c);
});

categoriesAdmin.patch('/:id', validate({ params: intIdParam, body: categoryBody.partial() }), async (req, res) => {
  const { params, body } = input<Partial<CategoryBody>, unknown, { id: number }>(req);
  const c = await prisma.category.update({ where: { id: params.id }, data: body });
  await cache.bump(CacheNs.catalog);
  audit({ action: 'category.update', entityType: 'category', entityId: c.id, meta: { fields: Object.keys(body) }, req });
  res.json(c);
});

categoriesAdmin.delete('/:id', validate({ params: intIdParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: number }>(req);
  await prisma.category.delete({ where: { id: params.id } });
  await cache.bump(CacheNs.catalog);
  audit({ action: 'category.delete', entityType: 'category', entityId: params.id, req });
  res.status(204).end();
});

// ───────────── Plans / үнэ (ADMIN)
export const plansAdmin = Router();
plansAdmin.use(requireRole('ADMIN'));

const planBody = z.object({
  code: z.string().trim().toLowerCase().min(1).max(40).regex(/^[a-z0-9_-]+$/),
  nameMn: cleanString(100).pipe(z.string().min(1)),
  nameEn: cleanString(100).pipe(z.string().min(1)),
  descriptionMn: cleanString(500).nullish(),
  descriptionEn: cleanString(500).nullish(),
  price: z.number().int().min(0).max(100_000_000),
  durationDays: z.number().int().min(1).max(3660),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
type PlanBody = z.infer<typeof planBody>;

plansAdmin.get('/', async (_req, res) => {
  const rows = await prisma.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { _count: { select: { subscriptions: true } } } });
  res.json(rows.map(({ _count, ...p }) => ({ ...p, subscriptionCount: _count.subscriptions })));
});

async function ensureSingleDefault(id: number, isDefault?: boolean) {
  if (isDefault) await prisma.plan.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
}

plansAdmin.post('/', validate({ body: planBody }), async (req, res) => {
  const { body } = input<PlanBody>(req);
  const p = await prisma.plan.create({ data: body });
  await ensureSingleDefault(p.id, body.isDefault);
  await cache.bump(CacheNs.plans, CacheNs.catalog);
  audit({ action: 'plan.create', entityType: 'plan', entityId: p.id, meta: { price: p.price }, req });
  res.status(201).json(p);
});

plansAdmin.patch('/:id', validate({ params: intIdParam, body: planBody.partial() }), async (req, res) => {
  const { params, body } = input<Partial<PlanBody>, unknown, { id: number }>(req);
  const before = await prisma.plan.findUnique({ where: { id: params.id } });
  if (!before) throw AppError.notFound();
  const p = await prisma.plan.update({ where: { id: params.id }, data: body });
  await ensureSingleDefault(p.id, body.isDefault);
  await cache.bump(CacheNs.plans, CacheNs.catalog);
  audit({ action: 'plan.update', entityType: 'plan', entityId: p.id, meta: { fields: Object.keys(body), priceBefore: before.price, priceAfter: p.price }, req });
  res.json(p);
});

plansAdmin.delete('/:id', validate({ params: intIdParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: number }>(req);
  const used = await prisma.subscription.count({ where: { planId: params.id } });
  if (used > 0) {
    await prisma.plan.update({ where: { id: params.id }, data: { isActive: false } });
    audit({ action: 'plan.deactivate', entityType: 'plan', entityId: params.id, req });
  } else {
    await prisma.plan.delete({ where: { id: params.id } });
    audit({ action: 'plan.delete', entityType: 'plan', entityId: params.id, req });
  }
  await cache.bump(CacheNs.plans, CacheNs.catalog);
  res.status(204).end();
});
