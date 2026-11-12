import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Loader2, Lock } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAccess, useMovie } from '@/lib/queries';
import { VideoPlayer, PlayerMessage } from '@/components/player/VideoPlayer';
import { ButtonLink, Button } from '@/components/ui';
import { pick } from '@/lib/format';
import type { EpisodeRef, PlaybackSession } from '@/types';

type State = { kind: 'loading' } | { kind: 'ready'; session: PlaybackSession } | { kind: 'error'; code: string; message: string };

const episodeLabel = (e: Pick<EpisodeRef, 'seasonNumber' | 'episodeNumber' | 'title' | 'titleEn'>) =>
  `S${e.seasonNumber}:E${e.episodeNumber}${pick(e.title, e.titleEn) ? ` · ${pick(e.title, e.titleEn)}` : ''}`;

export default function Watch() {
  const { t } = useTranslation();
  const { slug } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: movie, error: movieError } = useMovie(slug);
  const isSeries = movie?.kind === 'SERIES';
  const { data: access, isLoading: accessLoading } = useAccess(isSeries ? movie.id : undefined);
  const [state, setState] = useState<State>({ kind: 'loading' });

  // Цуврал: ?e= байхгүй бол сүүлд үзсэн эсвэл эхний бэлэн анги
  const episodeId = useMemo(() => {
    if (!movie || !isSeries) return undefined;
    const requested = params.get('e');
    if (requested && movie.episodes.some((e) => e.id === requested)) return requested;
    if (accessLoading) return undefined;
    const resume = movie.episodes.find((e) => e.id === access?.progress?.episodeId && e.videoReady);
    return (resume ?? movie.episodes.find((e) => e.videoReady))?.id;
  }, [movie, isSeries, params, access, accessLoading]);

  const sessionPath = !movie ? null : isSeries ? (episodeId ? `/playback/episodes/${episodeId}/session` : null) : `/playback/${movie.id}/session`;
  const noEpisode = Boolean(movie && isSeries && !accessLoading && !episodeId);

  useEffect(() => {
    if (noEpisode) setState({ kind: 'error', code: 'NO_EPISODE', message: t('movie.noEpisodes') });
  }, [noEpisode, t]);

  // Session нь зөвхөн тоглуулах зам (кино/анги) өөрчлөгдөхөд л шинээр үүснэ
  useEffect(() => {
    if (!sessionPath) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    api<PlaybackSession>(sessionPath, { method: 'POST' })
      .then((session) => !cancelled && setState({ kind: 'ready', session }))
      .catch((err) => !cancelled && setState({ kind: 'error', code: err instanceof ApiError ? err.code : 'ERROR', message: err.message }));
    return () => {
      cancelled = true;
    };
  }, [sessionPath]);

  const back = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['me'] });
    navigate(movie ? `/movie/${movie.slug}` : '/');
  }, [navigate, movie, qc]);

  const onFatal = useCallback(
    (reason: 'revoked' | 'error') => setState({ kind: 'error', code: reason === 'revoked' ? 'SESSION_REVOKED' : 'ERROR', message: '' }),
    [],
  );

  const nextEp = state.kind === 'ready' ? state.session.next : null;
  const next = useMemo(
    () =>
      nextEp && movie
        ? { label: episodeLabel(nextEp), onPlay: () => navigate(`/watch/${movie.slug}?e=${nextEp.id}`, { replace: true }) }
        : null,
    [nextEp, movie, navigate],
  );

  if (movieError) return <PlayerMessage text={t('common.error')} action={<ButtonLink to="/">{t('checkout.goHome')}</ButtonLink>} />;

  if (state.kind === 'error') {
    if (state.code === 'NOT_ENTITLED')
      return (
        <PlayerMessage
          icon={<Lock className="size-12 text-accent" />}
          text={isSeries ? t('movie.locked') : t('player.notEntitled')}
          action={<ButtonLink to={movie ? `/movie/${movie.slug}` : '/pricing'}>{t('player.getAccess')}</ButtonLink>}
        />
      );
    if (state.code === 'SESSION_REVOKED')
      return <PlayerMessage text={t('player.revoked')} action={<ButtonLink to="/login">{t('nav.login')}</ButtonLink>} />;
    return (
      <PlayerMessage
        text={state.message || t('player.error')}
        action={
          <Button variant="outline" onClick={back}>
            {t('common.back')}
          </Button>
        }
      />
    );
  }

  if (state.kind === 'loading' || !movie) {
    return (
      <div className="grid h-dvh place-items-center bg-black">
        <Loader2 className="size-12 animate-spin text-white/70" />
      </div>
    );
  }

  const episode = state.session.episode;
  return (
    <VideoPlayer
      key={episode?.id ?? movie.id}
      movieId={movie.id}
      episodeId={episode?.id}
      title={pick(movie.title, movie.titleEn)}
      subtitle={episode ? episodeLabel(episode) : undefined}
      session={state.session}
      poster={movie.backdrop?.src}
      next={next}
      onBack={back}
      onFatal={onFatal}
    />
  );
}
