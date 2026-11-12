import type { Prisma } from '@prisma/client';

/** Зургийн хувилбаруудын өргөн — upload хийхэд эдгээр хэмжээгээр webp үүсгэнэ */
export const POSTER_WIDTHS = [240, 360, 540, 720] as const;
export const BACKDROP_WIDTHS = [640, 1280, 1920] as const;
export const STILL_WIDTHS = [320, 640, 1280] as const;

export interface ImageSet {
  src: string;
  srcSet: string;
}

export function imageSet(baseUrl: string, key: string | null, widths: readonly number[], defaultWidth: number): ImageSet | null {
  if (!key || !baseUrl) return null;
  const url = (w: number) => `${baseUrl}/${key}-${w}.webp`;
  return { src: url(defaultWidth), srcSet: widths.map((w) => `${url(w)} ${w}w`).join(', ') };
}

export const cardSelect = {
  id: true,
  kind: true,
  slug: true,
  title: true,
  titleEn: true,
  releaseYear: true,
  durationSec: true,
  ageRating: true,
  imdbRating: true,
  posterKey: true,
  posterColor: true,
  backdropKey: true,
  accessType: true,
  publishedAt: true,
} satisfies Prisma.MovieSelect;

export type CardRow = Prisma.MovieGetPayload<{ select: typeof cardSelect }>;

export function toCard(m: CardRow, assetsUrl: string) {
  return {
    id: m.id,
    kind: m.kind,
    slug: m.slug,
    title: m.title,
    titleEn: m.titleEn,
    releaseYear: m.releaseYear,
    durationSec: m.durationSec,
    ageRating: m.ageRating,
    imdbRating: m.imdbRating ? Number(m.imdbRating) : null,
    accessType: m.accessType,
    posterColor: m.posterColor,
    poster: imageSet(assetsUrl, m.posterKey, POSTER_WIDTHS, 360),
    backdrop: imageSet(assetsUrl, m.backdropKey, BACKDROP_WIDTHS, 1280),
    publishedAt: m.publishedAt,
  };
}

export type MovieCard = ReturnType<typeof toCard>;

// ── Reels
export const reelSelect = {
  id: true,
  caption: true,
  videoKey: true,
  posterKey: true,
  durationSec: true,
  width: true,
  height: true,
  viewCount: true,
  movie: { select: { ...cardSelect, status: true } },
} satisfies Prisma.ReelSelect;

export type ReelRow = Prisma.ReelGetPayload<{ select: typeof reelSelect }>;

export function toReel(r: ReelRow, assetsUrl: string) {
  return {
    id: r.id,
    caption: r.caption,
    video: assetsUrl && r.videoKey ? `${assetsUrl}/${r.videoKey}` : null,
    poster: assetsUrl && r.posterKey ? `${assetsUrl}/${r.posterKey}` : null,
    durationSec: r.durationSec,
    width: r.width,
    height: r.height,
    viewCount: r.viewCount,
    // Нийтлэгдээгүй кино руу холбоос гаргахгүй
    movie: r.movie && r.movie.status === 'PUBLISHED' ? toCard(r.movie, assetsUrl) : null,
  };
}

/** Нийтэд харагдах reel-ийн нөхцөл */
export const publicReelWhere = {
  status: 'PUBLISHED',
  videoStatus: 'READY',
  OR: [{ movieId: null }, { movie: { status: 'PUBLISHED' } }],
} satisfies Prisma.ReelWhereInput;
