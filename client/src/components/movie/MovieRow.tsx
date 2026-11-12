import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { MovieCard as Movie } from '@/types';
import { MovieCard, MovieCardSkeleton } from './MovieCard';
import { Skeleton } from '../ui';

const itemClass = 'w-[42vw] shrink-0 snap-start sm:w-[28vw] lg:w-[19vw] xl:w-[15.5vw] 2xl:w-[13.5vw] max-w-[240px]';

/** Хэвтээ гүйдэг жагсаалт. Дэлгэцэнд ойртох үед л зурагдана (lazy render). */
export function MovieRow({ title, movies, href, loading, icon }: { title: string; movies?: Movie[]; href?: string; loading?: boolean; icon?: ReactNode }) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && (setVisible(true), io.disconnect()), { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const updateEdges = () => {
    const s = scroller.current;
    if (!s) return;
    setEdges({ start: s.scrollLeft < 8, end: s.scrollLeft + s.clientWidth >= s.scrollWidth - 8 });
  };

  const scrollBy = (dir: 1 | -1) => {
    const s = scroller.current;
    if (s) s.scrollBy({ left: dir * s.clientWidth * 0.85, behavior: 'smooth' });
  };

  if (!loading && movies && movies.length === 0) return null;

  return (
    <section ref={sentinel} className="group/row relative py-3 sm:py-4">
      <div className="mb-3 flex items-end justify-between gap-4 px-4 sm:px-8 lg:px-12">
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-xl">
          {icon}
          {title}
        </h2>
        {href && (
          <Link to={href} className="text-sm font-medium text-muted transition hover:text-accent">
            {t('common.viewAll')} →
          </Link>
        )}
      </div>

      <div className="relative">
        <div
          ref={scroller}
          onScroll={updateEdges}
          className="no-scrollbar flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-3 pb-8 sm:scroll-px-8 sm:gap-4 sm:px-8 lg:scroll-px-12 lg:px-12"
        >
          {loading || !visible || !movies
            ? Array.from({ length: 8 }, (_, i) => (
                <div key={i} className={itemClass}>
                  <MovieCardSkeleton />
                </div>
              ))
            : movies.map((m, i) => (
                <div key={m.id} className={itemClass}>
                  <MovieCard movie={m} priority={i < 3} />
                </div>
              ))}
        </div>

        {visible && movies && movies.length > 4 && (
          <>
            <button
              onClick={() => scrollBy(-1)}
              aria-label="Previous"
              className={`absolute top-1/2 left-2 hidden -translate-y-1/2 rounded-full border border-line bg-surface/90 p-2.5 shadow-xl backdrop-blur transition-opacity hover:bg-elevated md:block ${edges.start ? 'pointer-events-none opacity-0' : 'opacity-0 group-hover/row:opacity-100'}`}
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              onClick={() => scrollBy(1)}
              aria-label="Next"
              className={`absolute top-1/2 right-2 hidden -translate-y-1/2 rounded-full border border-line bg-surface/90 p-2.5 shadow-xl backdrop-blur transition-opacity hover:bg-elevated md:block ${edges.end ? 'pointer-events-none opacity-0' : 'opacity-0 group-hover/row:opacity-100'}`}
            >
              <ChevronRight className="size-5" />
            </button>
          </>
        )}
      </div>
    </section>
  );
}

export function MovieGrid({ movies, loading, count = 12 }: { movies?: Movie[]; loading?: boolean; count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {movies?.map((m, i) => <MovieCard key={m.id} movie={m} priority={i < 6} />)}
      {loading && Array.from({ length: count }, (_, i) => <MovieCardSkeleton key={`s${i}`} />)}
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="px-4 py-4 sm:px-8 lg:px-12">
      <Skeleton className="mb-4 h-6 w-40" />
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className={itemClass}>
            <MovieCardSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
