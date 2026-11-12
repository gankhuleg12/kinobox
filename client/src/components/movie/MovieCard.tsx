import { memo, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import type { MovieCard as Movie } from '@/types';
import { Img } from './Img';
import { Skeleton } from '../ui';
import { formatDuration, pick } from '@/lib/format';

export const CARD_SIZES = '(min-width:1536px) 14vw, (min-width:1280px) 16vw, (min-width:1024px) 20vw, (min-width:640px) 28vw, 42vw';

export const MovieCard = memo(function MovieCard({ movie, priority }: { movie: Movie; priority?: boolean }) {
  const { t } = useTranslation();
  const title = pick(movie.title, movie.titleEn);
  const progress = movie.progress?.durationSec ? Math.min(100, (movie.progress.positionSec / movie.progress.durationSec) * 100) : null;

  return (
    <Link
      to={`/movie/${movie.slug}`}
      className="glow-card group block outline-none"
      style={{ '--glow': movie.posterColor ?? undefined } as CSSProperties}
      aria-label={title}
    >
      <div className="relative aspect-2/3 overflow-hidden rounded-2xl">
        <Img image={movie.poster} alt={title} sizes={CARD_SIZES} color={movie.posterColor} priority={priority} className="absolute inset-0" />

        <div className="absolute inset-x-0 top-0 flex justify-between p-2">
          <div className="flex flex-wrap gap-1">
            {movie.kind === 'SERIES' && <span className="rounded-md bg-violet-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white uppercase">{t('common.series')}</span>}
            {movie.accessType === 'FREE' ? (
              <span className="rounded-md bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-bold text-white uppercase">{t('common.free')}</span>
            ) : movie.accessType === 'RENT_ONLY' ? (
              <span className="rounded-md bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-bold text-white uppercase">{t('common.rentOnly')}</span>
            ) : null}
          </div>
          {movie.ageRating && <span className="rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">{movie.ageRating}</span>}
        </div>

        {/* Hover үед гарах мэдээлэл */}
        <div className="absolute inset-x-0 bottom-0 translate-y-2 bg-linear-to-t from-black/90 via-black/50 to-transparent p-3 pt-10 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
          <p className="line-clamp-2 text-sm font-semibold text-white">{title}</p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-white/70">
            {movie.releaseYear && <span>{movie.releaseYear}</span>}
            {movie.durationSec ? <span>· {formatDuration(movie.durationSec)}</span> : null}
            {movie.imdbRating ? (
              <span className="flex items-center gap-0.5 text-amber-300">
                · <Star className="size-3 fill-current" /> {movie.imdbRating.toFixed(1)}
              </span>
            ) : null}
          </div>
        </div>

        {progress !== null && (
          <div className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-white/25">
            <div className="h-full bg-gradient-brand" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      <p className="mt-2 truncate px-0.5 text-sm font-medium text-fg/90 sm:hidden">{title}</p>
    </Link>
  );
});

export function MovieCardSkeleton() {
  return <Skeleton className="aspect-2/3 w-full rounded-2xl" />;
}
