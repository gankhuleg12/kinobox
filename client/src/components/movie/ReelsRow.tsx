import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Clapperboard, Play, Eye } from 'lucide-react';
import type { Reel } from '@/types';
import { pick } from '@/lib/format';

/** Нүүр хуудасны reels мөр: босоо thumbnail-ууд, дарахад reels feed тэр reel-ээс эхэлнэ */
export function ReelsRow({ reels }: { reels: Reel[] }) {
  const { t } = useTranslation();
  if (!reels.length) return null;

  return (
    <section className="py-3 sm:py-4">
      <div className="mb-3 flex items-end justify-between gap-4 px-4 sm:px-8 lg:px-12">
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-xl">
          <Clapperboard className="size-5 text-accent-2" /> {t('home.reels')}
        </h2>
        <Link to="/reels" className="text-sm font-medium text-muted transition hover:text-accent">
          {t('common.viewAll')} →
        </Link>
      </div>
      <div className="no-scrollbar flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-2 pb-6 sm:scroll-px-8 sm:px-8 lg:scroll-px-12 lg:px-12">
        {reels.map((r) => (
          <Link
            key={r.id}
            to={`/reels/${r.id}`}
            className="glow-card group relative aspect-9/16 w-[34vw] max-w-[180px] shrink-0 snap-start overflow-hidden rounded-2xl bg-elevated sm:w-[22vw] lg:w-[14vw]"
            style={{ '--glow': r.movie?.posterColor ?? undefined } as CSSProperties}
          >
            {r.poster && <img src={r.poster} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />}
            <div className="absolute inset-0 bg-linear-to-t from-black/80 via-transparent to-transparent" />
            <span className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-black/40 opacity-0 backdrop-blur transition group-hover:opacity-100">
              <Play className="ml-0.5 size-4 fill-white text-white" />
            </span>
            <div className="absolute inset-x-0 bottom-0 p-2.5 text-white">
              {r.movie && <p className="truncate text-xs font-semibold">{pick(r.movie.title, r.movie.titleEn)}</p>}
              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-white/70">
                <Eye className="size-3" /> {r.viewCount.toLocaleString()}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
