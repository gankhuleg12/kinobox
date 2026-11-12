import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Search as SearchIcon, X, SearchX } from 'lucide-react';
import { useSearch } from '@/lib/queries';
import { MovieGrid } from '@/components/movie/MovieRow';
import { EmptyState, Spinner } from '@/components/ui';

export default function Search() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(value);
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;

  // 300ms debounce — бичих бүрт хүсэлт илгээхгүй
  useEffect(() => {
    const id = setTimeout(() => {
      const q = value.trim();
      setDebounced(q);
      setParamsRef.current(q ? { q } : {}, { replace: true });
    }, 300);
    return () => clearTimeout(id);
  }, [value]);

  const { data, isFetching } = useSearch(debounced);

  return (
    <div className="px-4 pt-10 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-2xl">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-subtle" />
          <input
            autoFocus
            type="search"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('search.placeholder')}
            maxLength={100}
            className="h-14 w-full rounded-2xl border border-line-strong bg-surface pr-12 pl-14 text-base shadow-sm transition focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none"
          />
          {isFetching ? (
            <Spinner className="absolute top-1/2 right-4 size-5 -translate-y-1/2" />
          ) : value ? (
            <button onClick={() => setValue('')} className="absolute top-1/2 right-4 -translate-y-1/2 text-subtle hover:text-fg" aria-label="Clear">
              <X className="size-5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-10">
        {!debounced ? (
          <p className="text-center text-muted">{t('search.hint')}</p>
        ) : data && data.items.length === 0 ? (
          <EmptyState icon={<SearchX className="size-10" />} title={t('search.empty')} />
        ) : (
          <>
            {data && <h2 className="mb-6 text-lg font-semibold">{t('search.resultsFor', { q: debounced })}</h2>}
            <MovieGrid movies={data?.items} loading={!data} />
          </>
        )}
      </div>
    </div>
  );
}
