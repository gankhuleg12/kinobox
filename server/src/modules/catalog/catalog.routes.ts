import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { rateLimits } from '../../middleware/rateLimit.js';
import { validate, input, slugSchema, idParam } from '../../middleware/validate.js';
import { catalogService, type SortKey } from './catalog.service.js';
import { settings } from '../settings/settings.service.js';

export const catalogRouter = Router();

/** Public, хэрэглэгчээс хамааралгүй хариунд CDN/browser cache зөвшөөрнө */
const publicCache =
  (maxAge: number, swr = maxAge * 4): RequestHandler =>
  (_req, res, next) => {
    res.set('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${swr}`);
    next();
  };

catalogRouter.get('/config', publicCache(60), async (_req, res) => {
  res.json(await settings.publicConfig());
});

catalogRouter.get('/home', publicCache(60), async (_req, res) => {
  res.json(await catalogService.home());
});

catalogRouter.get('/categories', publicCache(300), async (_req, res) => {
  res.json(await catalogService.categories());
});

catalogRouter.get('/plans', publicCache(300), async (_req, res) => {
  res.json(await catalogService.plans());
});

const listQuery = z.object({
  category: slugSchema.optional(),
  sort: z.enum(['new', 'popular', 'year', 'title']).default('new'),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});
catalogRouter.get('/movies', publicCache(30), validate({ query: listQuery }), async (req, res) => {
  const { query } = input<unknown, z.infer<typeof listQuery>>(req);
  res.json(await catalogService.list({ ...query, sort: query.sort as SortKey }));
});

const searchQuery = z.object({ q: z.string().max(100).default(''), limit: z.coerce.number().int().min(1).max(40).default(24) });
catalogRouter.get('/search', rateLimits.search, publicCache(30), validate({ query: searchQuery }), async (req, res) => {
  const { query } = input<unknown, z.infer<typeof searchQuery>>(req);
  res.json(await catalogService.search(query.q, query.limit));
});

catalogRouter.get('/movies/:slug', publicCache(60), validate({ params: z.object({ slug: slugSchema }) }), async (req, res) => {
  const { params } = input<unknown, unknown, { slug: string }>(req);
  const movie = await catalogService.detail(params.slug);
  if (!movie) throw AppError.notFound('Кино олдсонгүй');
  res.json(movie);
});

// ── Reels: cursor pagination (infinite scroll)
const reelsQuery = z.object({ cursor: idParam.shape.id.optional(), limit: z.coerce.number().int().min(1).max(20).default(8) });
catalogRouter.get('/reels', publicCache(30), validate({ query: reelsQuery }), async (req, res) => {
  const { query } = input<unknown, z.infer<typeof reelsQuery>>(req);
  res.json(await catalogService.reels(query.cursor, query.limit));
});

catalogRouter.get('/reels/:id', publicCache(60), validate({ params: idParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  const reel = await catalogService.reel(params.id);
  if (!reel) throw AppError.notFound('Reel олдсонгүй');
  res.json(reel);
});

catalogRouter.post('/reels/:id/view', rateLimits.search, validate({ params: idParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  await catalogService.reelView(params.id, req.ip ?? '0.0.0.0');
  res.status(204).end();
});
