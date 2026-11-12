import type { AccessType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { cache, CacheNs } from '../../lib/cache.js';

export type AccessReason = 'FREE' | 'FREE_EPISODE' | 'SUBSCRIPTION' | 'RENTAL' | 'STAFF';

/**
 * Цувралын ангийн дараалал (0-ээс): зөвхөн нийтлэгдсэн ангиудыг (улирал, анги)-ын
 * дарааллаар тоолно. Catalog, admin, playback бүгд энэ нэг дүрмийг ашиглана.
 */
export async function episodeRank(ep: { movieId: string; seasonNumber: number; episodeNumber: number }) {
  return prisma.episode.count({
    where: {
      movieId: ep.movieId,
      isPublished: true,
      OR: [{ seasonNumber: { lt: ep.seasonNumber } }, { seasonNumber: ep.seasonNumber, episodeNumber: { lt: ep.episodeNumber } }],
    },
  });
}

export interface AccessResult {
  allowed: boolean;
  reason: AccessReason | null;
  /** Эрх дуусах хугацаа (ISO) */
  expiresAt: string | null;
}

async function activeSubscription(userId: string) {
  const now = new Date();
  return prisma.subscription.findFirst({
    where: { userId, status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } },
    orderBy: { endsAt: 'desc' },
    include: { plan: { select: { code: true, nameMn: true, nameEn: true } } },
  });
}

/** Ирээдүйд эхлэх (сунгалт) subscription-уудыг оруулаад хамгийн сүүлийн дуусах огноо */
async function subscriptionEndsAt(userId: string): Promise<Date | null> {
  const last = await prisma.subscription.findFirst({
    where: { userId, status: 'ACTIVE', endsAt: { gt: new Date() } },
    orderBy: { endsAt: 'desc' },
    select: { endsAt: true },
  });
  return last?.endsAt ?? null;
}

export const entitlements = {
  activeSubscription,
  subscriptionEndsAt,

  async summary(userId: string) {
    return cache.wrap(CacheNs.entitlement(userId), 'summary', 60, async () => {
      const sub = await activeSubscription(userId);
      const endsAt = sub ? await subscriptionEndsAt(userId) : null;
      return sub
        ? { active: true, planCode: sub.plan.code, planNameMn: sub.plan.nameMn, planNameEn: sub.plan.nameEn, endsAt: endsAt?.toISOString() ?? null }
        : { active: false, planCode: null, planNameMn: null, planNameEn: null, endsAt: null };
    });
  },

  async check(userId: string, role: string, movie: { id: string; accessType: AccessType }): Promise<AccessResult> {
    if (role === 'ADMIN' || role === 'EDITOR') return { allowed: true, reason: 'STAFF', expiresAt: null };
    if (movie.accessType === 'FREE') return { allowed: true, reason: 'FREE', expiresAt: null };

    const compute = () =>
      cache.wrap(CacheNs.entitlement(userId), `movie:${movie.id}`, 60, async (): Promise<AccessResult> => {
        const now = new Date();
        const rental = await prisma.rental.findFirst({
          where: { userId, movieId: movie.id, startsAt: { lte: now }, expiresAt: { gt: now } },
          orderBy: { expiresAt: 'desc' },
          select: { expiresAt: true },
        });
        if (movie.accessType === 'SUBSCRIPTION') {
          const sub = await activeSubscription(userId);
          if (sub && (!rental || sub.endsAt > rental.expiresAt)) {
            return { allowed: true, reason: 'SUBSCRIPTION', expiresAt: sub.endsAt.toISOString() };
          }
        }
        if (rental) return { allowed: true, reason: 'RENTAL', expiresAt: rental.expiresAt.toISOString() };
        return { allowed: false, reason: null, expiresAt: null };
      });

    const result = await compute();
    // Cache дотор хугацаа нь дууссан эрх үлдсэн бол дахин тооцоолно
    if (result.allowed && result.expiresAt && new Date(result.expiresAt) <= new Date()) {
      await this.invalidate(userId);
      return compute();
    }
    return result;
  },

  /** Цувралын анги: эхний N анги нэвтэрсэн хэрэглэгчид үнэгүй, бусад нь кинотой ижил эрх */
  async checkEpisode(
    userId: string,
    role: string,
    movie: { id: string; accessType: AccessType; freeEpisodes: number },
    episode: { movieId: string; seasonNumber: number; episodeNumber: number },
  ): Promise<AccessResult> {
    if (role === 'ADMIN' || role === 'EDITOR') return { allowed: true, reason: 'STAFF', expiresAt: null };
    if (movie.accessType === 'FREE') return { allowed: true, reason: 'FREE', expiresAt: null };
    if (movie.freeEpisodes > 0 && (await episodeRank(episode)) < movie.freeEpisodes) {
      return { allowed: true, reason: 'FREE_EPISODE', expiresAt: null };
    }
    return this.check(userId, role, movie);
  },

  async invalidate(userId: string) {
    await cache.bump(CacheNs.entitlement(userId));
  },
};
