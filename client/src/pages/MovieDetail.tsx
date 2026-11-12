import { useState, type CSSProperties } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Play, Clapperboard, Star, Ticket, Crown, CheckCircle2, Clock, Lock } from 'lucide-react';
import { useAccess, useMovie } from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import { Img } from '@/components/movie/Img';
import { MovieRow } from '@/components/movie/MovieRow';
import { Badge, Button, ButtonLink, ErrorState, Modal, Skeleton } from '@/components/ui';
import { cn, formatClock, formatDate, formatDuration, formatPrice, pick, youtubeEmbed } from '@/lib/format';
import NotFound from './NotFound';
import { ApiError } from '@/lib/api';
import type { MovieDetail as Movie } from '@/types';

export default function MovieDetail() {
  const { slug } = useParams();
  const { data: movie, isLoading, error, refetch } = useMovie(slug);

  if (error instanceof ApiError && error.status === 404) return <NotFound />;
  if (error) return <div className="p-8"><ErrorState error={error} onRetry={() => void refetch()} /></div>;
  if (isLoading || !movie) return <DetailSkeleton />;
  return <MovieView movie={movie} />;
}

function MovieView({ movie }: { movie: Movie }) {
  const { t } = useTranslation();
  const [trailer, setTrailer] = useState(false);
  const title = pick(movie.title, movie.titleEn);
  const embed = youtubeEmbed(movie.trailerUrl);

  return (
    <div>
      <section className="relative -mt-16 min-h-[70vh] overflow-hidden">
        <Img image={movie.backdrop ?? movie.poster} alt="" sizes="100vw" color={movie.posterColor} priority className="absolute inset-0 opacity-60" />
        <div className="absolute inset-0 bg-linear-to-t from-bg via-bg/80 to-bg/40" />
        <div className="absolute inset-0 bg-linear-to-r from-bg via-bg/60 to-transparent" />
        <div className="pointer-events-none absolute -bottom-40 left-0 h-96 w-2/3 rounded-full opacity-25 blur-3xl" style={{ background: movie.posterColor ?? 'var(--accent)' }} />

        <div className="relative z-10 flex flex-col gap-8 px-4 pt-28 pb-12 sm:px-8 md:flex-row md:items-end lg:px-12">
          <div className="glow-card w-44 shrink-0 self-center sm:w-56 md:self-auto" style={{ '--glow': movie.posterColor ?? undefined } as CSSProperties}>
            <Img image={movie.poster} alt={title} sizes="224px" color={movie.posterColor} priority className="aspect-2/3 rounded-2xl shadow-2xl" />
          </div>

          <div className="max-w-3xl flex-1 animate-fade-in">
            <div className="flex flex-wrap gap-2">
              {movie.categories.map((c) => (
                <Link key={c.id} to={`/category/${c.slug}`} className="rounded-full border border-line-strong bg-surface/50 px-3 py-1 text-xs font-medium text-muted backdrop-blur hover:text-fg">
                  {pick(c.nameMn, c.nameEn)}
                </Link>
              ))}
            </div>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">{title}</h1>
            {movie.titleEn && movie.titleEn !== title && <p className="mt-1 text-lg text-muted">{movie.titleEn}</p>}

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
              {movie.imdbRating ? (
                <span className="flex items-center gap-1 font-semibold text-amber-500">
                  <Star className="size-4 fill-current" /> {movie.imdbRating.toFixed(1)}
                </span>
              ) : null}
              {movie.releaseYear && <span>{movie.releaseYear}</span>}
              {movie.kind === 'SERIES' ? (
                <span>{t('movie.episodeCount', { count: movie.episodes.length })}</span>
              ) : movie.durationSec ? (
                <span>{formatDuration(movie.durationSec)}</span>
              ) : null}
              {movie.ageRating && <span className="rounded border border-line-strong px-1.5 text-xs">{movie.ageRating}</span>}
              {movie.country && <span>{movie.country}</span>}
            </div>

            <p className="mt-5 max-w-2xl leading-relaxed whitespace-pre-line text-fg/85">{pick(movie.description, movie.descriptionEn)}</p>

            <AccessPanel movie={movie} onTrailer={embed ? () => setTrailer(true) : undefined} />

            <dl className="mt-8 grid gap-3 text-sm sm:grid-cols-2">
              {movie.director && (
                <div>
                  <dt className="text-subtle">{t('movie.director')}</dt>
                  <dd className="mt-0.5">{movie.director}</dd>
                </div>
              )}
              {movie.cast && (
                <div>
                  <dt className="text-subtle">{t('movie.cast')}</dt>
                  <dd className="mt-0.5">{movie.cast}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </section>

      {movie.kind === 'SERIES' && <EpisodesSection movie={movie} />}

      {movie.related.length > 0 && <MovieRow title={t('movie.related')} movies={movie.related} />}

      <Modal open={trailer} onClose={() => setTrailer(false)} title={`${title} — ${t('common.trailer')}`} wide>
        {embed && (
          <div className="aspect-video overflow-hidden rounded-xl bg-black">
            <iframe
              src={embed}
              title="Trailer"
              className="size-full"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-scripts allow-same-origin allow-presentation"
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

function AccessPanel({ movie, onTrailer }: { movie: Movie; onTrailer?: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const status = useAuth((s) => s.status);
  const { data, isLoading } = useAccess(status === 'authed' ? movie.id : undefined);
  const { pricing } = movie;
  const isSeries = movie.kind === 'SERIES';

  const trailerBtn = onTrailer && (
    <Button variant="outline" size="lg" onClick={onTrailer} icon={<Clapperboard className="size-5" />}>
      {t('common.trailer')}
    </Button>
  );

  if (status === 'loading' || (status === 'authed' && isLoading)) {
    return <Skeleton className="mt-8 h-12 w-64" />;
  }

  // Цуврал: сүүлд үзсэн анги, эсвэл эхний анги
  const resumeEpisode = isSeries ? (movie.episodes.find((e) => e.id === data?.progress?.episodeId) ?? movie.episodes[0]) : undefined;
  const watchHref = isSeries ? (resumeEpisode ? `/watch/${movie.slug}?e=${resumeEpisode.id}` : null) : `/watch/${movie.slug}`;
  const loginHref = (next: string) => `/login?next=${encodeURIComponent(next)}`;
  const firstFree = isSeries ? movie.episodes.find((e) => e.isFree && e.videoReady) : undefined;
  const allowed = data?.access.allowed;
  const resume = data?.progress?.positionSec && data.progress.positionSec > 30 ? data.progress.positionSec : 0;

  const freeNote = isSeries && movie.freeEpisodes > 0 && movie.accessType !== 'FREE' && (
    <Badge tone="success">{t('movie.freeEpisodesNote', { count: movie.freeEpisodes })}</Badge>
  );

  if (allowed) {
    const reasonLabel = data.access.reason === 'RENTAL' ? t('movie.viaRental') : data.access.reason === 'FREE' ? t('movie.viaFree') : t('movie.viaPlan');
    const resumeLabel =
      isSeries && resumeEpisode
        ? `S${resumeEpisode.seasonNumber}:E${resumeEpisode.episodeNumber}${resume ? ` · ${formatClock(resume)}` : ''}`
        : resume
          ? t('movie.continueAt', { time: formatClock(resume) })
          : t('movie.watchNow');
    return (
      <div className="mt-8 space-y-3">
        <div className="flex flex-wrap gap-3">
          {movie.videoReady && watchHref ? (
            <ButtonLink to={watchHref} size="lg">
              <Play className="size-5 fill-current" /> {resumeLabel}
            </ButtonLink>
          ) : (
            <Button size="lg" disabled icon={<Clock className="size-5" />}>
              {t('movie.videoNotReady')}
            </Button>
          )}
          {trailerBtn}
        </div>
        <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-4" /> {reasonLabel}
          {data.access.expiresAt && <span className="text-muted">· {t('movie.accessUntil', { date: formatDate(data.access.expiresAt, true) })}</span>}
        </p>
      </div>
    );
  }

  // Үнэгүй кино эсвэл үнэгүй анги — зочин хэрэглэгчийг нэвтрэх рүү
  if (movie.accessType === 'FREE' && status === 'guest') {
    return (
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink to={loginHref(watchHref ?? location.pathname)} size="lg">
          <Play className="size-5 fill-current" /> {t('movie.loginToWatch')}
        </ButtonLink>
        {trailerBtn}
      </div>
    );
  }

  const freeEpisodeHref = firstFree ? `/watch/${movie.slug}?e=${firstFree.id}` : null;

  return (
    <div className="mt-8 space-y-4">
      <div className="flex flex-wrap gap-2">
        {!movie.videoReady && <Badge tone="warning">{t('common.comingSoon')}</Badge>}
        {freeNote}
      </div>
      <div className="flex flex-wrap gap-3">
        {firstFree && freeEpisodeHref && (
          <ButtonLink to={status === 'guest' ? loginHref(freeEpisodeHref) : freeEpisodeHref} size="lg">
            <Play className="size-5 fill-current" /> {t('movie.watchFreeEpisode', { n: firstFree.episodeNumber })}
          </ButtonLink>
        )}
        <ButtonLink to={`/checkout/rent/${movie.slug}`} size="lg" variant={firstFree ? 'outline' : 'primary'}>
          <Ticket className="size-5" /> {t('movie.rentFor', { price: formatPrice(pricing.rentPrice), hours: pricing.rentHours })}
        </ButtonLink>
        {pricing.plan && (
          <ButtonLink to={`/checkout/plan/${pricing.plan.code}`} size="lg" variant="outline">
            <Crown className="size-5 text-amber-500" /> {t('movie.subscribeFor', { name: pick(pricing.plan.nameMn, pricing.plan.nameEn), price: formatPrice(pricing.plan.price) })}
          </ButtonLink>
        )}
        {trailerBtn}
      </div>
      {movie.accessType === 'RENT_ONLY' && <p className="text-sm text-muted">{t('movie.rentOnlyNote')}</p>}
    </div>
  );
}

/** Цувралын ангиуд: улирлаар шүүж, үнэгүй/түгжигдсэн төлөвийг харуулна */
function EpisodesSection({ movie }: { movie: Movie }) {
  const { t } = useTranslation();
  const status = useAuth((s) => s.status);
  const { data } = useAccess(status === 'authed' ? movie.id : undefined);
  const seasons = [...new Set(movie.episodes.map((e) => e.seasonNumber))];
  const [season, setSeason] = useState(() => movie.episodes.find((e) => e.id === data?.progress?.episodeId)?.seasonNumber ?? seasons[0] ?? 1);
  const allowedAll = Boolean(data?.access.allowed);
  const list = movie.episodes.filter((e) => e.seasonNumber === season);

  return (
    <section className="px-4 py-6 sm:px-8 lg:px-12">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight">{t('movie.episodes')}</h2>
        {seasons.length > 1 && (
          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {seasons.map((s) => (
              <button
                key={s}
                onClick={() => setSeason(s)}
                className={cn(
                  'shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition',
                  s === season ? 'border-transparent bg-gradient-brand text-white' : 'border-line-strong text-muted hover:text-fg',
                )}
              >
                {t('movie.season', { n: s })}
              </button>
            ))}
          </div>
        )}
      </div>

      {movie.episodes.length === 0 ? (
        <p className="text-sm text-muted">{t('movie.noEpisodes')}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((e) => {
            const unlocked = allowedAll || e.isFree;
            const href = `/watch/${movie.slug}?e=${e.id}`;
            const to = !e.videoReady ? undefined : status === 'guest' ? `/login?next=${encodeURIComponent(href)}` : unlocked ? href : `/checkout/rent/${movie.slug}`;
            const current = data?.progress?.episodeId === e.id;
            const body = (
              <div className={cn('group flex gap-3 rounded-2xl border bg-surface p-2.5 transition', current ? 'border-accent/50' : 'border-line', to && 'hover:border-accent/40 hover:bg-elevated/60')}>
                <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-xl sm:w-40">
                  <Img image={e.still ?? movie.backdrop} alt="" sizes="160px" color={movie.posterColor} className="absolute inset-0" />
                  <span className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition group-hover:opacity-100">
                    {unlocked ? <Play className="size-7 fill-white text-white" /> : <Lock className="size-6 text-white" />}
                  </span>
                  {!unlocked && (
                    <span className="absolute top-1.5 right-1.5 rounded-md bg-black/60 p-1 backdrop-blur">
                      <Lock className="size-3 text-white" />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1 py-0.5">
                  <p className="text-xs font-semibold text-muted">
                    {t('movie.episode', { n: e.episodeNumber })}
                    {e.durationSec ? ` · ${formatDuration(e.durationSec)}` : ''}
                  </p>
                  <p className="mt-0.5 truncate text-sm font-semibold">{pick(e.title, e.titleEn) || t('movie.episode', { n: e.episodeNumber })}</p>
                  {e.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{e.description}</p>}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {e.isFree && movie.accessType !== 'FREE' && <Badge tone="success">{t('movie.freeEpisode')}</Badge>}
                    {!e.videoReady && <Badge tone="warning">{t('common.comingSoon')}</Badge>}
                  </div>
                </div>
              </div>
            );
            return <li key={e.id}>{to ? <Link to={to} title={!unlocked ? t('movie.locked') : undefined}>{body}</Link> : body}</li>;
          })}
        </ul>
      )}
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-8 px-4 pt-12 sm:px-8 md:flex-row lg:px-12">
      <Skeleton className="aspect-2/3 w-44 self-center rounded-2xl sm:w-56 md:self-auto" />
      <div className="flex-1 space-y-4 pt-8">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-24 w-full max-w-2xl" />
        <Skeleton className="h-12 w-72" />
      </div>
    </div>
  );
}
