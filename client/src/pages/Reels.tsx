import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Volume2, VolumeX, Share2, Play, Film, Clapperboard, Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { useReel, useReels } from '@/lib/queries';
import { EmptyState, Spinner, toast } from '@/components/ui';
import { Img } from '@/components/movie/Img';
import { cn, pick } from '@/lib/format';
import type { Reel } from '@/types';

const viewed = new Set<string>();

/**
 * Reels: босоо snap-scroll feed.
 *  - Зөвхөн дэлгэцэн дээрх reel тоглоно; дараагийнх нь урьдчилан ачаалагдана, бусад нь сүлжээ ашиглахгүй
 *  - Autoplay-ийн бодлогоор дуугүй эхэлнэ; нэг товшилтоор бүх reel-ийн дууг нээнэ
 *  - Reel бүрээс холбогдох кино руу шууд орно
 */
export default function Reels() {
  const { t } = useTranslation();
  const { id: startId } = useParams();
  const feed = useReels();
  const start = useReel(startId);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const container = useRef<HTMLDivElement>(null);

  // Deep link-ээр орсон reel-ийг эхэнд, дараа нь feed (давхардалгүй)
  const items = useMemo(() => {
    const list = feed.data?.pages.flatMap((p) => p.items) ?? [];
    if (!start.data) return list;
    return [start.data, ...list.filter((r) => r.id !== start.data!.id)];
  }, [feed.data, start.data]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  useEffect(() => {
    if (items.length && active >= items.length - 3 && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [active, items.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Хуваалцахад зориулж URL-г шинэчилнэ (router-ийг дахин рендер хийлгэхгүй)
  useEffect(() => {
    const reel = items[active];
    if (reel) window.history.replaceState(window.history.state, '', `/reels/${reel.id}`);
  }, [active, items]);

  const scrollTo = useCallback((index: number) => {
    const el = container.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'ArrowDown' || e.key === 'j') (e.preventDefault(), scrollTo(Math.min(active + 1, items.length - 1)));
      if (e.key === 'ArrowUp' || e.key === 'k') (e.preventDefault(), scrollTo(Math.max(active - 1, 0)));
      if (e.key === 'm') setMuted((m) => !m);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, items.length, scrollTo]);

  if ((feed.isLoading || (startId && start.isLoading)) && !items.length) {
    return (
      <div className="grid h-[calc(100dvh-4rem)] place-items-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="px-4 py-16 sm:px-8">
        <EmptyState icon={<Clapperboard className="size-10" />} title={t('reels.empty')} />
      </div>
    );
  }

  return (
    <div ref={container} className="no-scrollbar h-[calc(100dvh-4rem)] snap-y snap-mandatory overflow-y-auto overscroll-contain bg-black sm:bg-bg">
      {items.map((reel, i) => (
        <ReelItem
          key={reel.id}
          reel={reel}
          index={i}
          active={i === active}
          preload={Math.abs(i - active) <= 1}
          muted={muted}
          onMuteToggle={() => setMuted((m) => !m)}
          onVisible={setActive}
        />
      ))}
      {isFetchingNextPage && (
        <div className="flex h-24 snap-start items-center justify-center">
          <Spinner />
        </div>
      )}
    </div>
  );
}

function ReelItem({
  reel,
  index,
  active,
  preload,
  muted,
  onMuteToggle,
  onVisible,
}: {
  reel: Reel;
  index: number;
  active: boolean;
  preload: boolean;
  muted: boolean;
  onMuteToggle: () => void;
  onVisible: (i: number) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const landscape = (reel.width ?? 9) > (reel.height ?? 16);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && onVisible(index), { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, [index, onVisible]);

  // Идэвхтэй болоход тоглуулж, бусад үед зогсооно
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (active) {
      v.currentTime = 0;
      void v.play().then(
        () => setPaused(false),
        () => setPaused(true),
      );
      // 2 сек үзсэн бол үзэлт гэж тооцно (сешн бүрт нэг удаа)
      const timer = window.setTimeout(() => {
        if (viewed.has(reel.id)) return;
        viewed.add(reel.id);
        void api(`/catalog/reels/${reel.id}/view`, { method: 'POST' }).catch(() => undefined);
      }, 2000);
      return () => window.clearTimeout(timer);
    }
    v.pause();
  }, [active, reel.id]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().then(() => setPaused(false));
    else {
      v.pause();
      setPaused(true);
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/reels/${reel.id}`;
    try {
      if (navigator.share) await navigator.share({ url, title: reel.movie?.title ?? 'Reel' });
      else {
        await navigator.clipboard.writeText(url);
        toast.success(t('reels.linkCopied'));
      }
    } catch {
      /* хэрэглэгч цуцалсан */
    }
  };

  const movie = reel.movie;

  return (
    <section ref={ref} className="relative flex h-full snap-start snap-always items-center justify-center sm:py-4">
      <div className="relative flex h-full w-full items-end justify-center gap-4 sm:w-auto">
        <div className="relative h-full w-full overflow-hidden bg-black sm:aspect-9/16 sm:w-auto sm:rounded-3xl sm:shadow-2xl">
          {reel.video ? (
            <video
              ref={video}
              src={reel.video}
              poster={reel.poster ?? undefined}
              muted={muted}
              loop
              playsInline
              preload={preload ? 'auto' : 'none'}
              onClick={toggle}
              onTimeUpdate={(e) => e.currentTarget.duration && setProgress((e.currentTarget.currentTime / e.currentTarget.duration) * 100)}
              className={cn('size-full', landscape ? 'object-contain' : 'object-cover')}
            />
          ) : reel.poster ? (
            <img src={reel.poster} alt="" className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center text-white/40">
              <Film className="size-10" />
            </div>
          )}

          {paused && (
            <button onClick={toggle} className="absolute inset-0 grid place-items-center" aria-label="Play">
              <span className="grid size-16 place-items-center rounded-full bg-black/40 backdrop-blur">
                <Play className="ml-1 size-8 fill-white text-white" />
              </span>
            </button>
          )}

          {muted && active && (
            <button onClick={onMuteToggle} className="absolute top-4 left-4 flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
              <VolumeX className="size-4" /> {t('reels.tapToUnmute')}
            </button>
          )}

          {/* Доод мэдээлэл + кино руу орох */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 via-black/40 to-transparent p-4 pt-24 text-white">
            {reel.caption && <p className="pointer-events-auto mb-3 line-clamp-3 pr-16 text-sm leading-relaxed text-white/90 sm:pr-0">{reel.caption}</p>}
            {movie && (
              <Link to={`/movie/${movie.slug}`} className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-white/10 p-2 pr-3 backdrop-blur-md transition hover:bg-white/20">
                <Img image={movie.poster} alt="" sizes="48px" color={movie.posterColor} className="aspect-2/3 w-11 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{pick(movie.title, movie.titleEn)}</p>
                  <p className="text-xs text-white/60">
                    {movie.kind === 'SERIES' ? t('common.series') : movie.releaseYear}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-brand px-3 py-2 text-xs font-bold">
                  <Play className="size-3.5 fill-current" /> {movie.kind === 'SERIES' ? t('reels.watchSeries') : t('reels.watchMovie')}
                </span>
              </Link>
            )}
          </div>

          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20">
            <div className="h-full bg-white/90" style={{ width: `${progress}%` }} />
          </div>

          {/* Mobile: баруун талын товчнууд */}
          <div className="absolute right-3 bottom-36 flex flex-col items-center gap-4 text-white sm:hidden">
            <ActionButtons muted={muted} onMuteToggle={onMuteToggle} onShare={() => void share()} views={reel.viewCount} />
          </div>
        </div>

        {/* Desktop: видеоны хажууд */}
        <div className="hidden flex-col items-center gap-4 pb-6 sm:flex">
          <ActionButtons muted={muted} onMuteToggle={onMuteToggle} onShare={() => void share()} views={reel.viewCount} />
        </div>
      </div>
    </section>
  );
}

function ActionButtons({ muted, onMuteToggle, onShare, views }: { muted: boolean; onMuteToggle: () => void; onShare: () => void; views: number }) {
  const { t } = useTranslation();
  const btn = 'grid size-12 place-items-center rounded-full bg-black/40 backdrop-blur transition hover:bg-black/60 sm:bg-elevated sm:text-fg sm:hover:bg-line-strong';
  return (
    <>
      <button onClick={onMuteToggle} className={btn} aria-label={muted ? 'Unmute' : 'Mute'}>
        {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
      </button>
      <div className="flex flex-col items-center gap-1">
        <button onClick={onShare} className={btn} aria-label={t('reels.share')}>
          <Share2 className="size-5" />
        </button>
        <span className="text-[11px] font-medium sm:text-muted">{t('reels.share')}</span>
      </div>
      <div className="flex flex-col items-center gap-1" title={t('reels.views', { count: views })}>
        <span className={btn}>
          <Eye className="size-5" />
        </span>
        <span className="text-[11px] font-medium tabular-nums sm:text-muted">{views.toLocaleString()}</span>
      </div>
    </>
  );
}
