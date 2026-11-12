import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { cache, CacheNs } from '../../lib/cache.js';
import { AppError } from '../../lib/errors.js';
import { settings } from '../settings/settings.service.js';
import { redis } from '../../lib/redis.js';
import { cardSelect, toCard, imageSet, BACKDROP_WIDTHS, POSTER_WIDTHS, STILL_WIDTHS, reelSelect, toReel, publicReelWhere } from './catalog.mapper.js';

const published = { status: 'PUBLISHED' } as const;
const reelOrder: Prisma.ReelOrderByWithRelationInput[] = [{ sortOrder: 'asc' }, { publishedAt: 'desc' }, { id: 'desc' }];
const assetsUrl = () => settings.get('r2.assetsPublicUrl');

export type SortKey = 'new' | 'popular' | 'year' | 'title';
const orderBy: Record<SortKey, Prisma.MovieOrderByWithRelationInput[]> = {
  new: [{ publishedAt: 'desc' }, { id: 'desc' }],
  popular: [{ viewCount: 'desc' }, { id: 'desc' }],
  year: [{ releaseYear: 'desc' }, { id: 'desc' }],
  title: [{ title: 'asc' }],
};

/** MySQL BOOLEAN MODE-ийн тусгай тэмдэгтүүдийг хасаж, үг бүрт prefix хайлт хийнэ */
export function toBooleanQuery(q: string): string {
  return q
    .replace(/[+\-<>()~*"@]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 8)
    .map((w) => `+${w}*`)
    .join(' ');
}

async function planForPricing() {
  return cache.wrap(CacheNs.plans, 'default', 300, async () => {
    const code = await settings.get('pricing.monthlyPlanCode');
    const plan =
      (await prisma.plan.findFirst({ where: { code, isActive: true } })) ??
      (await prisma.plan.findFirst({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }] }));
    return plan ? { code: plan.code, nameMn: plan.nameMn, nameEn: plan.nameEn, price: plan.price, durationDays: plan.durationDays } : null;
  });
}

export const catalogService = {
  planForPricing,

  async categories() {
    return cache.wrap(CacheNs.catalog, 'categories', 300, () =>
      prisma.category.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true, slug: true, nameMn: true, nameEn: true },
      }),
    );
  },

  async plans() {
    return cache.wrap(CacheNs.plans, 'list', 300, () =>
      prisma.plan.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
        select: { id: true, code: true, nameMn: true, nameEn: true, descriptionMn: true, descriptionEn: true, price: true, durationDays: true, isDefault: true },
      }),
    );
  },

  async home() {
    return cache.wrap(CacheNs.catalog, 'home', 120, async () => {
      const base = await assetsUrl();
      const [featured, newest, popular, cats, reels] = await Promise.all([
        prisma.movie.findMany({
          where: { ...published, isFeatured: true },
          orderBy: { publishedAt: 'desc' },
          take: 6,
          select: { ...cardSelect, description: true, descriptionEn: true, trailerUrl: true },
        }),
        prisma.movie.findMany({ where: published, orderBy: orderBy.new, take: 20, select: cardSelect }),
        prisma.movie.findMany({ where: published, orderBy: orderBy.popular, take: 20, select: cardSelect }),
        prisma.category.findMany({ where: { isActive: true, showOnHome: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: 12 }),
        prisma.reel.findMany({ where: publicReelWhere, orderBy: reelOrder, take: 12, select: reelSelect }),
      ]);

      const rows = await Promise.all(
        cats.map(async (c) => ({
          category: { id: c.id, slug: c.slug, nameMn: c.nameMn, nameEn: c.nameEn },
          movies: (
            await prisma.movie.findMany({
              where: { ...published, categories: { some: { categoryId: c.id } } },
              orderBy: orderBy.new,
              take: 20,
              select: cardSelect,
            })
          ).map((m) => toCard(m, base)),
        })),
      );

      return {
        featured: featured.map((m) => ({
          ...toCard(m, base),
          description: m.description.slice(0, 400),
          descriptionEn: m.descriptionEn?.slice(0, 400) ?? null,
          trailerUrl: m.trailerUrl,
        })),
        newReleases: newest.map((m) => toCard(m, base)),
        popular: popular.map((m) => toCard(m, base)),
        reels: reels.map((r) => toReel(r, base)),
        categories: rows.filter((r) => r.movies.length > 0),
      };
    });
  },

  async list(params: { category?: string; sort: SortKey; year?: number; page: number; limit: number }) {
    const key = `list:${params.category ?? '*'}:${params.sort}:${params.year ?? '*'}:${params.page}:${params.limit}`;
    return cache.wrap(CacheNs.catalog, key, 60, async () => {
      const where: Prisma.MovieWhereInput = {
        ...published,
        ...(params.year ? { releaseYear: params.year } : {}),
        ...(params.category ? { categories: { some: { category: { slug: params.category, isActive: true } } } } : {}),
      };
      const [total, items] = await Promise.all([
        prisma.movie.count({ where }),
        prisma.movie.findMany({
          where,
          orderBy: orderBy[params.sort],
          skip: (params.page - 1) * params.limit,
          take: params.limit,
          select: cardSelect,
        }),
      ]);
      const base = await assetsUrl();
      return { items: items.map((m) => toCard(m, base)), total, page: params.page, pages: Math.ceil(total / params.limit) };
    });
  },

  async search(q: string, limit: number) {
    const term = q.trim().slice(0, 100);
    if (!term) return { items: [] };
    return cache.wrap(CacheNs.catalog, `search:${limit}:${term.toLowerCase()}`, 60, async () => {
      let ids: string[] = [];
      const boolean = toBooleanQuery(term);
      if (boolean) {
        // Tagged template → parameterized query (SQL injection-аас хамгаалагдсан)
        const rows = await prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM Movie
          WHERE status = 'PUBLISHED'
            AND MATCH(title, titleEn, description) AGAINST (${boolean} IN BOOLEAN MODE)
          ORDER BY MATCH(title, titleEn, description) AGAINST (${boolean} IN BOOLEAN MODE) DESC
          LIMIT ${limit}`;
        ids = rows.map((r) => r.id);
      }
      // Богино үг эсвэл fulltext үр дүнгүй бол LIKE fallback
      if (ids.length === 0) {
        const rows = await prisma.movie.findMany({
          where: { ...published, OR: [{ title: { contains: term } }, { titleEn: { contains: term } }, { cast: { contains: term } }, { director: { contains: term } }] },
          orderBy: orderBy.popular,
          take: limit,
          select: { id: true },
        });
        ids = rows.map((r) => r.id);
      }
      if (!ids.length) return { items: [] };
      const movies = await prisma.movie.findMany({ where: { id: { in: ids } }, select: cardSelect });
      const base = await assetsUrl();
      const byId = new Map(movies.map((m) => [m.id, m]));
      return { items: ids.flatMap((id) => (byId.has(id) ? [toCard(byId.get(id)!, base)] : [])) };
    });
  },

  async detail(slug: string) {
    return cache.wrap(CacheNs.catalog, `movie:${slug}`, 120, async () => {
      const m = await prisma.movie.findFirst({
        where: { slug, ...published },
        include: { categories: { include: { category: { select: { id: true, slug: true, nameMn: true, nameEn: true, isActive: true } } } } },
      });
      if (!m) return null;

      const [base, pricing, plan] = await Promise.all([
        assetsUrl(),
        settings.getMany(['pricing.defaultRentPrice', 'pricing.defaultRentHours']),
        planForPricing(),
      ]);
      const episodes =
        m.kind === 'SERIES'
          ? await prisma.episode.findMany({
              where: { movieId: m.id, isPublished: true },
              orderBy: [{ seasonNumber: 'asc' }, { episodeNumber: 'asc' }],
              select: { id: true, seasonNumber: true, episodeNumber: true, title: true, titleEn: true, description: true, durationSec: true, stillKey: true, videoStatus: true },
            })
          : [];
      const categoryIds = m.categories.map((c) => c.categoryId);
      const related = await prisma.movie.findMany({
        where: { ...published, id: { not: m.id }, ...(categoryIds.length ? { categories: { some: { categoryId: { in: categoryIds } } } } : {}) },
        orderBy: orderBy.popular,
        take: 12,
        select: cardSelect,
      });

      return {
        id: m.id,
        kind: m.kind,
        freeEpisodes: m.freeEpisodes,
        slug: m.slug,
        title: m.title,
        titleEn: m.titleEn,
        description: m.description,
        descriptionEn: m.descriptionEn,
        releaseYear: m.releaseYear,
        durationSec: m.durationSec,
        ageRating: m.ageRating,
        imdbRating: m.imdbRating ? Number(m.imdbRating) : null,
        country: m.country,
        director: m.director,
        cast: m.cast,
        trailerUrl: m.trailerUrl,
        accessType: m.accessType,
        posterColor: m.posterColor,
        poster: imageSet(base, m.posterKey, POSTER_WIDTHS, 540),
        backdrop: imageSet(base, m.backdropKey, BACKDROP_WIDTHS, 1920),
        videoReady: m.kind === 'SERIES' ? episodes.some((e) => e.videoStatus === 'READY') : m.videoStatus === 'READY',
        // Үнэгүй анги: нийтлэгдсэн ангиудын эхний N (entitlement.episodeRank-тай ижил дүрэм)
        episodes: episodes.map(({ stillKey, videoStatus, ...e }, i) => ({
          ...e,
          still: imageSet(base, stillKey, STILL_WIDTHS, 640),
          videoReady: videoStatus === 'READY',
          isFree: m.accessType === 'FREE' || i < m.freeEpisodes,
        })),
        categories: m.categories.filter((c) => c.category.isActive).map(({ category: { isActive: _a, ...c } }) => c),
        pricing: {
          rentPrice: m.rentPrice ?? pricing['pricing.defaultRentPrice'],
          rentHours: m.rentHours ?? pricing['pricing.defaultRentHours'],
          plan: m.accessType === 'SUBSCRIPTION' ? plan : null,
        },
        related: related.map((r) => toCard(r, base)),
      };
    });
  },

  async reels(cursor: string | undefined, limit: number) {
    return cache.wrap(CacheNs.catalog, `reels:${cursor ?? '-'}:${limit}`, 60, async () => {
      const rows = await prisma.reel.findMany({
        where: publicReelWhere,
        orderBy: reelOrder,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: reelSelect,
      });
      const base = await assetsUrl();
      const items = rows.slice(0, limit);
      return { items: items.map((r) => toReel(r, base)), nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
    });
  },

  async reel(id: string) {
    return cache.wrap(CacheNs.catalog, `reel:${id}`, 60, async () => {
      const r = await prisma.reel.findFirst({ where: { id, ...publicReelWhere }, select: reelSelect });
      return r ? toReel(r, await assetsUrl()) : null;
    });
  },

  /** Үзэлт: IP бүрээс өдөрт нэг удаа тоологдоно */
  async reelView(id: string, ip: string) {
    const day = new Date().toISOString().slice(0, 10);
    if (await redis.set(`rv:${id}:${ip}:${day}`, '1', 'EX', 86_400, 'NX')) {
      await prisma.reel.updateMany({ where: { id, ...publicReelWhere }, data: { viewCount: { increment: 1 } } });
    }
  },

  async requirePublishedMovie(where: { id: string } | { slug: string }) {
    const m = await prisma.movie.findFirst({ where: { ...where, ...published } });
    if (!m) throw AppError.notFound('Кино олдсонгүй');
    return m;
  },
};
