import { useTranslation } from 'react-i18next';
import { Sparkles, Flame, History } from 'lucide-react';
import { useContinueWatching, useHome } from '@/lib/queries';
import { Hero, HeroSkeleton } from '@/components/movie/Hero';
import { MovieRow, RowSkeleton } from '@/components/movie/MovieRow';
import { ReelsRow } from '@/components/movie/ReelsRow';
import { ButtonLink, ErrorState } from '@/components/ui';
import { pick } from '@/lib/format';

export default function Home() {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useHome();
  const { data: continueWatching } = useContinueWatching();

  if (error) {
    return (
      <div className="px-4 py-24 sm:px-8">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <div>
      {isLoading || !data ? <HeroSkeleton /> : data.featured.length ? <Hero movies={data.featured} /> : <div className="h-8" />}

      <div className="relative z-10 -mt-16 space-y-2 sm:-mt-24">
        {isLoading || !data ? (
          <>
            <RowSkeleton />
            <RowSkeleton />
          </>
        ) : (
          <>
            {continueWatching && continueWatching.length > 0 && (
              <MovieRow title={t('home.continueWatching')} movies={continueWatching} icon={<History className="size-5 text-accent" />} />
            )}
            <MovieRow title={t('home.newReleases')} movies={data.newReleases} href="/browse?sort=new" icon={<Sparkles className="size-5 text-accent" />} />
            <ReelsRow reels={data.reels} />
            <MovieRow title={t('home.popular')} movies={data.popular} href="/browse?sort=popular" icon={<Flame className="size-5 text-accent-2" />} />

            <section className="px-4 py-8 sm:px-8 lg:px-12">
              <div className="relative overflow-hidden rounded-3xl border border-line bg-surface p-8 sm:p-12">
                <div className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-accent/25 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-24 left-1/3 size-72 rounded-full bg-accent-2/20 blur-3xl" />
                <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                  <div className="max-w-xl">
                    <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('home.ctaTitle')}</h2>
                    <p className="mt-2 text-muted">{t('home.ctaText')}</p>
                  </div>
                  <ButtonLink to="/pricing" size="lg">
                    {t('home.ctaButton')}
                  </ButtonLink>
                </div>
              </div>
            </section>

            {data.categories.map((row) => (
              <MovieRow key={row.category.id} title={pick(row.category.nameMn, row.category.nameEn)} movies={row.movies} href={`/category/${row.category.slug}`} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
