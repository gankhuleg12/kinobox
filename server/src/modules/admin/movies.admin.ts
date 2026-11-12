import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { r2 } from '../../lib/r2.js';
import { cache, CacheNs } from '../../lib/cache.js';
import { AppError } from '../../lib/errors.js';
import { randomToken } from '../../lib/crypto.js';
import { validate, input, idParam, cleanString, cleanText, slugSchema, paginate } from '../../middleware/validate.js';
import { audit } from '../audit/audit.service.js';
import { settings } from '../settings/settings.service.js';
import { processAndUploadImage, deleteImageSet, type ImageKind } from '../media/image.service.js';
import { normalizeCode } from '../facebook/bot.service.js';
import { imageSet, POSTER_WIDTHS } from '../catalog/catalog.mapper.js';
import { slugify } from './slug.js';
import { videoUploadRouter } from './video-upload.js';

export const moviesAdmin = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
const invalidate = () => cache.bump(CacheNs.catalog);

const nullableInt = (min: number, max: number) => z.number().int().min(min).max(max).nullish();
const trailerUrl = z
  .url()
  .max(500)
  .refine((u) => /^https:\/\/(www\.)?(youtube\.com|youtu\.be|player\.vimeo\.com|vimeo\.com)\//.test(u), 'Зөвхөн YouTube/Vimeo холбоос зөвшөөрнө');

const movieBody = z.object({
  title: cleanString(200).pipe(z.string().min(1, 'Гарчиг шаардлагатай')),
  titleEn: cleanString(200).nullish(),
  slug: slugSchema.optional(),
  description: cleanText(5000).pipe(z.string().min(1, 'Тайлбар шаардлагатай')),
  descriptionEn: cleanText(5000).nullish(),
  releaseYear: nullableInt(1888, 2100),
  durationSec: nullableInt(0, 86_400),
  ageRating: cleanString(10).nullish(),
  imdbRating: z.number().min(0).max(10).nullish(),
  country: cleanString(80).nullish(),
  director: cleanString(160).nullish(),
  cast: cleanString(500).nullish(),
  trailerUrl: trailerUrl.nullish().or(z.literal('').transform(() => null)),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  isFeatured: z.boolean().optional(),
  accessType: z.enum(['SUBSCRIPTION', 'RENT_ONLY', 'FREE']).optional(),
  rentPrice: nullableInt(0, 10_000_000),
  rentHours: nullableInt(1, 8760),
  fbCode: z
    .string()
    .max(20)
    .nullish()
    .transform((v) => (v ? normalizeCode(v) : null))
    .refine((v) => v === null || /^[A-Z0-9_-]{1,20}$/.test(v), 'Код зөвхөн үсэг, тоо агуулна'),
  categoryIds: z.array(z.number().int().positive()).max(20).optional(),
  kind: z.enum(['MOVIE', 'SERIES']).optional(),
  freeEpisodes: z.number().int().min(0).max(500).optional(),
});
type MovieBody = z.infer<typeof movieBody>;

async function uniqueSlug(base: string, excludeId?: string) {
  const root = base || `movie-${randomToken(4).toLowerCase()}`;
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const exists = await prisma.movie.findFirst({ where: { slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } });
    if (!exists) return candidate;
  }
  return `${root}-${randomToken(4).toLowerCase()}`;
}

function toData(body: Partial<MovieBody>) {
  const { categoryIds: _c, slug: _s, imdbRating, ...rest } = body;
  return {
    ...rest,
    ...(imdbRating !== undefined ? { imdbRating: imdbRating === null ? null : new Prisma.Decimal(imdbRating.toFixed(1)) } : {}),
  };
}

// ── Жагсаалт
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  videoStatus: z.enum(['NONE', 'UPLOADING', 'QUEUED', 'PROCESSING', 'READY', 'FAILED']).optional(),
  kind: z.enum(['MOVIE', 'SERIES']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
moviesAdmin.get('/', validate({ query: listQuery }), async (req, res) => {
  const { query } = input<unknown, z.infer<typeof listQuery>>(req);
  const where: Prisma.MovieWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.videoStatus ? { videoStatus: query.videoStatus } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.q ? { OR: [{ title: { contains: query.q } }, { titleEn: { contains: query.q } }, { slug: { contains: query.q } }, { fbCode: query.q.toUpperCase() }] } : {}),
  };
  const [items, total, base] = await Promise.all([
    prisma.movie.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      ...paginate(query.page, query.limit),
      select: {
        id: true, slug: true, title: true, releaseYear: true, status: true, isFeatured: true, accessType: true, kind: true, freeEpisodes: true,
        _count: { select: { episodes: true } },
        rentPrice: true, fbCode: true, videoStatus: true, videoProgress: true, posterKey: true, posterColor: true,
        viewCount: true, updatedAt: true,
      },
    }),
    prisma.movie.count({ where }),
    settings.get('r2.assetsPublicUrl'),
  ]);
  res.json({
    items: items.map(({ posterKey, _count, ...m }) => ({ ...m, episodeCount: _count.episodes, poster: imageSet(base, posterKey, POSTER_WIDTHS, 240) })),
    total,
    page: query.page,
    pages: Math.ceil(total / query.limit),
  });
});

moviesAdmin.get('/:id', validate({ params: idParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  const m = await prisma.movie.findUnique({ where: { id: params.id }, include: { categories: { select: { categoryId: true } } } });
  if (!m) throw AppError.notFound();
  const base = await settings.get('r2.assetsPublicUrl');
  const { hlsKeyEnc: _k, categories, ...rest } = m;
  res.json({
    ...rest,
    imdbRating: m.imdbRating ? Number(m.imdbRating) : null,
    categoryIds: categories.map((c) => c.categoryId),
    poster: imageSet(base, m.posterKey, POSTER_WIDTHS, 360),
    backdrop: m.backdropKey && base ? `${base}/${m.backdropKey}-640.webp` : null,
  });
});

moviesAdmin.post('/', validate({ body: movieBody }), async (req, res) => {
  const { body } = input<MovieBody>(req);
  const slug = await uniqueSlug(body.slug ?? slugify(body.titleEn || body.title));
  const movie = await prisma.movie.create({
    data: {
      ...toData(body),
      title: body.title,
      description: body.description,
      slug,
      publishedAt: body.status === 'PUBLISHED' ? new Date() : null,
      categories: body.categoryIds?.length ? { create: body.categoryIds.map((categoryId) => ({ categoryId })) } : undefined,
    },
  });
  await invalidate();
  audit({ action: 'movie.create', entityType: 'movie', entityId: movie.id, meta: { title: movie.title }, req });
  res.status(201).json({ id: movie.id, slug: movie.slug });
});

moviesAdmin.patch('/:id', validate({ params: idParam, body: movieBody.partial() }), async (req, res) => {
  const { params, body } = input<Partial<MovieBody>, unknown, { id: string }>(req);
  const existing = await prisma.movie.findUnique({ where: { id: params.id } });
  if (!existing) throw AppError.notFound();

  const slug = body.slug && body.slug !== existing.slug ? await uniqueSlug(body.slug, existing.id) : undefined;
  const movie = await prisma.$transaction(async (tx) => {
    if (body.categoryIds) {
      await tx.movieCategory.deleteMany({ where: { movieId: existing.id } });
      if (body.categoryIds.length) {
        await tx.movieCategory.createMany({ data: body.categoryIds.map((categoryId) => ({ movieId: existing.id, categoryId })), skipDuplicates: true });
      }
    }
    return tx.movie.update({
      where: { id: existing.id },
      data: {
        ...toData(body),
        ...(slug ? { slug } : {}),
        ...(body.status === 'PUBLISHED' && !existing.publishedAt ? { publishedAt: new Date() } : {}),
      },
    });
  });
  await invalidate();
  audit({ action: 'movie.update', entityType: 'movie', entityId: movie.id, meta: { fields: Object.keys(body) }, req });
  res.json({ id: movie.id, slug: movie.slug });
});

moviesAdmin.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  const movie = await prisma.movie.findUnique({ where: { id: params.id } });
  if (!movie) throw AppError.notFound();
  const paid = await prisma.payment.count({ where: { movieId: movie.id, status: 'PAID' } });
  if (paid > 0) throw AppError.conflict('Төлбөр төлөгдсөн кино тул устгах боломжгүй. "Архивлах" төлөвийг ашиглана уу.');

  await prisma.movie.delete({ where: { id: movie.id } });
  await invalidate();
  audit({ action: 'movie.delete', entityType: 'movie', entityId: movie.id, meta: { title: movie.title }, req });

  // R2 цэвэрлэгээ (background)
  void Promise.allSettled([
    deleteImageSet('poster', movie.posterKey),
    deleteImageSet('backdrop', movie.backdropKey),
    r2.deletePrefix('media', `movies/${movie.id}/`),
    r2.deletePrefix('media', `sources/${movie.id}/`),
  ]);
  res.status(204).end();
});

// ── Зураг upload
for (const kind of ['poster', 'backdrop'] as ImageKind[]) {
  moviesAdmin.post(`/:id/${kind}`, validate({ params: idParam }), upload.single('file'), async (req, res) => {
    const { params } = input<unknown, unknown, { id: string }>(req);
    if (!req.file) throw AppError.badRequest('Файл сонгоно уу');
    const movie = await prisma.movie.findUnique({ where: { id: params.id }, select: { id: true, posterKey: true, backdropKey: true } });
    if (!movie) throw AppError.notFound();

    const { key, color } = await processAndUploadImage(movie.id, kind, req.file.buffer);
    await prisma.movie.update({
      where: { id: movie.id },
      data: kind === 'poster' ? { posterKey: key, posterColor: color } : { backdropKey: key },
    });
    await deleteImageSet(kind, kind === 'poster' ? movie.posterKey : movie.backdropKey);
    await invalidate();
    audit({ action: `movie.${kind}.upload`, entityType: 'movie', entityId: movie.id, req });
    res.json({ key, color });
  });
}

// ── Видео upload (кино түвшинд; цувралд анги бүр дээр)
moviesAdmin.use('/:id/video', videoUploadRouter('movie'));

moviesAdmin.get('/:id/video/status', validate({ params: idParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  const m = await prisma.movie.findUnique({ where: { id: params.id }, select: { videoStatus: true, videoProgress: true, videoError: true, renditions: true, durationSec: true } });
  if (!m) throw AppError.notFound();
  res.json(m);
});
