import { useEffect, useRef } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Clapperboard } from 'lucide-react';
import { useCategories, useMovieList } from '@/lib/queries';
import { MovieGrid } from '@/components/movie/MovieRow';
import { EmptyState, ErrorState, Select, Spinner } from '@/components/ui';
import { cn, pick } from '@/lib/format';

const SORTS = ['new', 'popular', 'year', 'title'] as const;

export default function Browse() {
  const { t } = useTranslation();
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const sort = SORTS.includes(params.get('sort') as (typeof SORTS)[number]) ? (params.get('sort') as string) : 'new';
  const { data: categories } = useCategories();
  const category = categories?.find((c) => c.slug === slug);
  const query = useMovieList({ category: slug, sort });
  const sentinel = useRef<HTMLDivElement>(null);

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && hasNextPage && !isFetchingNextPage && void fetchNextPage(), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const movies = query.data?.pages.flatMap((p) => p.items);
  const total = query.data?.pages[0]?.total;
  const title = category ? pick(category.nameMn, category.nameEn) : t('browse.allMovies');

  return (
    <div className="px-4 pt-8 sm:px-8 lg:px-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
          {total !== undefined && <p className="mt-1 text-sm text-muted">{t('browse.count', { count: total })}</p>}
        </div>
        <Select
          value={sort}
          onChange={(e) => setParams((p) => (p.set('sort', e.target.value), p), { replace: true })}
          className="w-full sm:w-44"
          aria-label="Sort"
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`browse.sort.${s}`)}
            </option>
          ))}
        </Select>
      </div>

      <div className="no-scrollbar -mx-4 mt-6 mb-8 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        <Chip to="/browse" active={!slug} label={t('browse.allMovies')} />
        {categories?.map((c) => <Chip key={c.id} to={`/category/${c.slug}`} active={c.slug === slug} label={pick(c.nameMn, c.nameEn)} />)}
      </div>

      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : movies && movies.length === 0 ? (
        <EmptyState icon={<Clapperboard className="size-10" />} title={t('common.noResults')} />
      ) : (
        <MovieGrid movies={movies} loading={query.isLoading} />
      )}

      <div ref={sentinel} className="flex justify-center py-10">
        {isFetchingNextPage && <Spinner />}
      </div>
    </div>
  );
}

function Chip({ to, active, label }: { to: string; active: boolean; label: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition',
        active ? 'border-transparent bg-gradient-brand text-white shadow-lg shadow-accent/25' : 'border-line-strong text-muted hover:border-accent/50 hover:text-fg',
      )}
    >
      {label}
    </Link>
  );
}
