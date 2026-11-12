import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type HlsType from 'hls.js';
import { ArrowLeft, Pause, Play, Volume2, VolumeX, Maximize, Minimize, Settings, RotateCcw, RotateCw, Loader2, ShieldAlert } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatClock, cn } from '@/lib/format';
import type { PlaybackSession } from '@/types';

interface Props {
  movieId: string;
  /** Цувралын анги тоглуулж байгаа бол */
  episodeId?: string;
  title: string;
  subtitle?: string;
  session: PlaybackSession;
  poster?: string;
  /** Дараагийн анги (дуусахад автоматаар шилжинэ) */
  next?: { label: string; onPlay: () => void } | null;
  onBack: () => void;
  onFatal: (reason: 'revoked' | 'error') => void;
}

const AUTO_NEXT_SEC = 8;

interface Level {
  index: number;
  height: number;
}

/**
 * HLS тоглуулагч.
 *  - hls.js-ийг зөвхөн энэ хуудсанд lazy ачаална (Safari-д native HLS)
 *  - 30 сек тутам heartbeat: үзсэн байрлал хадгалж, session идэвхтэй эсэхийг шалгана
 *  - Өөр төхөөрөмжөөс нэвтэрвэл (401) тоглуулалт шууд зогсоно
 */
export function VideoPlayer({ movieId, episodeId, title, subtitle, session, poster, next, onBack, onFatal }: Props) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<HlsType | null>(null);
  const hideTimer = useRef<number>(0);

  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(session.durationSec ?? 0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controls, setControls] = useState(true);
  const [levels, setLevels] = useState<Level[]>([]);
  const [level, setLevel] = useState(-1);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_NEXT_SEC);

  // Дуусахад дараагийн анги руу тоолон шилжинэ
  useEffect(() => {
    if (!ended || !next) return;
    setCountdown(AUTO_NEXT_SEC);
    const id = window.setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => window.clearInterval(id);
  }, [ended, next]);
  useEffect(() => {
    if (ended && next && countdown <= 0) next.onPlay();
  }, [ended, next, countdown]);

  // ── HLS ачаалах
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    let destroyed = false;
    const src = session.manifestUrl;
    const resume = () => {
      if (session.resumeAt > 5 && (!el.duration || session.resumeAt < el.duration - 10)) el.currentTime = session.resumeAt;
      void el.play().catch(() => setPlaying(false));
    };

    if (el.canPlayType('application/vnd.apple.mpegurl') && !/Chrome|Android/.test(navigator.userAgent)) {
      el.src = src;
      el.addEventListener('loadedmetadata', resume, { once: true });
    } else {
      void import('hls.js').then(({ default: Hls }) => {
        if (destroyed) return;
        if (!Hls.isSupported()) return onFatal('error');
        const hls = new Hls({
          enableWorker: true,
          capLevelToPlayerSize: true,
          maxBufferLength: 30,
          backBufferLength: 60,
          startPosition: session.resumeAt > 5 ? session.resumeAt : -1,
        });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(el);
        hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
          setLevels(data.levels.map((l, index) => ({ index, height: l.height })).sort((a, b) => b.height - a.height));
          void el.play().catch(() => setPlaying(false));
        });
        let mediaRecoveries = 0;
        hls.on(Hls.Events.ERROR, (_e, data) => {
          const code = (data.response as { code?: number } | undefined)?.code;
          if (code === 401 || code === 403) {
            hls.destroy();
            return onFatal(code === 401 ? 'revoked' : 'error');
          }
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries++ < 3) hls.recoverMediaError();
          else {
            hls.destroy();
            onFatal('error');
          }
        });
      });
    }

    return () => {
      destroyed = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [session, onFatal]);

  // ── Heartbeat
  const sendHeartbeat = useCallback(
    async (keepalive = false) => {
      const el = video.current;
      if (!el || !el.currentTime) return;
      try {
        await api('/playback/heartbeat', {
          method: 'POST',
          keepalive,
          body: {
            movieId,
            episodeId,
            positionSec: Math.floor(el.currentTime),
            durationSec: Number.isFinite(el.duration) ? Math.floor(el.duration) : undefined,
          },
        });
      } catch (err) {
        if (err instanceof ApiError && err.code === 'SESSION_REVOKED') {
          el.pause();
          hlsRef.current?.destroy();
          onFatal('revoked');
        }
      }
    },
    [movieId, episodeId, onFatal],
  );

  useEffect(() => {
    const id = window.setInterval(() => void sendHeartbeat(), session.heartbeatSec * 1000);
    const onHide = () => document.visibilityState === 'hidden' && void sendHeartbeat(true);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onHide);
      void sendHeartbeat(true);
    };
  }, [sendHeartbeat, session.heartbeatSec]);

  // ── Controls
  const showControls = useCallback(() => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!video.current?.paused) {
        setControls(false);
        setQualityOpen(false);
      }
    }, 3000);
  }, []);

  const togglePlay = useCallback(() => {
    const el = video.current;
    if (!el) return;
    if (el.paused) void el.play();
    else {
      el.pause();
      void sendHeartbeat();
    }
  }, [sendHeartbeat]);

  const seek = useCallback((delta: number) => {
    const el = video.current;
    if (el) el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + delta));
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.current?.requestFullscreen?.();
  }, []);

  const toggleMute = useCallback(() => {
    const el = video.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const actions: Record<string, () => void> = {
        ' ': togglePlay,
        k: togglePlay,
        ArrowLeft: () => seek(-10),
        ArrowRight: () => seek(10),
        j: () => seek(-10),
        l: () => seek(10),
        f: toggleFullscreen,
        m: toggleMute,
      };
      const action = actions[e.key];
      if (action) {
        e.preventDefault();
        action();
        showControls();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('keydown', onKey);
    };
  }, [togglePlay, seek, toggleFullscreen, toggleMute, showControls]);

  const selectLevel = (index: number) => {
    if (hlsRef.current) hlsRef.current.currentLevel = index;
    setLevel(index);
    setQualityOpen(false);
  };

  const pct = duration ? (time / duration) * 100 : 0;
  const bufPct = duration ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={container}
      className={cn('relative h-dvh w-full bg-black text-white select-none', !controls && 'cursor-none')}
      onMouseMove={showControls}
      onTouchStart={showControls}
    >
      <video
        ref={video}
        className="absolute inset-0 size-full"
        poster={poster}
        playsInline
        preload="auto"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onPlay={() => (setPlaying(true), setEnded(false), showControls())}
        onEnded={() => (setEnded(true), void sendHeartbeat())}
        onPause={() => (setPlaying(false), setControls(true))}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onProgress={(e) => {
          const b = e.currentTarget.buffered;
          if (b.length) setBuffered(b.end(b.length - 1));
        }}
        onVolumeChange={(e) => (setVolume(e.currentTarget.volume), setMuted(e.currentTarget.muted))}
        onContextMenu={(e) => e.preventDefault()}
      />

      {buffering && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <Loader2 className="size-14 animate-spin text-white/80" />
        </div>
      )}

      <div className={cn('absolute inset-0 flex flex-col justify-between transition-opacity duration-300', controls ? 'opacity-100' : 'pointer-events-none opacity-0')}>
        <div className="flex items-center gap-4 bg-linear-to-b from-black/80 to-transparent p-4 sm:p-6">
          <button onClick={onBack} className="rounded-full p-2 transition hover:bg-white/15" aria-label={t('player.back')}>
            <ArrowLeft className="size-6" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{title}</h1>
            {subtitle && <p className="truncate text-sm text-white/70">{subtitle}</p>}
          </div>
        </div>

        {ended && next && (
          <div className="absolute right-6 bottom-28 z-10 w-72 rounded-2xl border border-white/10 bg-black/80 p-4 backdrop-blur animate-fade-in">
            <p className="text-xs tracking-wider text-white/60 uppercase">{t('player.upNext')}</p>
            <p className="mt-1 truncate font-semibold">{next.label}</p>
            <button onClick={next.onPlay} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-brand py-2.5 text-sm font-semibold">
              <Play className="size-4 fill-current" /> {t('player.nextEpisode')} · {Math.max(0, countdown)}
            </button>
          </div>
        )}

        {!playing && !buffering && (
          <button onClick={togglePlay} className="absolute top-1/2 left-1/2 grid size-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-gradient-brand shadow-2xl shadow-accent/50 transition hover:scale-105" aria-label={t('player.play')}>
            <Play className="ml-1 size-9 fill-current" />
          </button>
        )}

        <div className="bg-linear-to-t from-black/90 to-transparent px-4 pt-16 pb-4 sm:px-6">
          <div className="group relative h-4">
            <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-white/20 transition-all group-hover:h-1.5">
              <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${bufPct}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-brand" style={{ width: `${pct}%` }} />
            </div>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={1}
              value={time}
              onChange={(e) => video.current && (video.current.currentTime = Number(e.target.value))}
              className="kb-range absolute inset-0 w-full cursor-pointer opacity-0 group-hover:opacity-100"
              aria-label="Seek"
            />
          </div>

          <div className="mt-2 flex items-center gap-1 sm:gap-2">
            <IconBtn onClick={togglePlay} label={playing ? t('player.pause') : t('player.play')}>
              {playing ? <Pause className="size-6 fill-current" /> : <Play className="size-6 fill-current" />}
            </IconBtn>
            <IconBtn onClick={() => seek(-10)} label="-10s">
              <RotateCcw className="size-5" />
            </IconBtn>
            <IconBtn onClick={() => seek(10)} label="+10s">
              <RotateCw className="size-5" />
            </IconBtn>
            <div className="group/vol flex items-center">
              <IconBtn onClick={toggleMute} label={muted ? t('player.unmute') : t('player.mute')}>
                {muted || volume === 0 ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
              </IconBtn>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  if (!video.current) return;
                  video.current.volume = Number(e.target.value);
                  video.current.muted = Number(e.target.value) === 0;
                }}
                className="kb-range hidden w-0 transition-all group-hover/vol:w-24 sm:block"
                aria-label="Volume"
              />
            </div>
            <span className="ml-2 text-sm text-white/80 tabular-nums">
              {formatClock(time)} / {formatClock(duration)}
            </span>

            <div className="ml-auto flex items-center gap-1">
              {levels.length > 1 && (
                <div className="relative">
                  <IconBtn onClick={() => setQualityOpen((v) => !v)} label={t('player.quality')}>
                    <Settings className={cn('size-5 transition-transform', qualityOpen && 'rotate-45')} />
                  </IconBtn>
                  {qualityOpen && (
                    <div className="absolute right-0 bottom-full mb-2 w-36 overflow-hidden rounded-xl border border-white/10 bg-black/90 py-1 backdrop-blur">
                      {[{ index: -1, height: 0 }, ...levels].map((l) => (
                        <button
                          key={l.index}
                          onClick={() => selectLevel(l.index)}
                          className={cn('block w-full px-4 py-2 text-left text-sm hover:bg-white/10', level === l.index && 'font-semibold text-accent')}
                        >
                          {l.index === -1 ? t('player.auto') : `${l.height}p`}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <IconBtn onClick={toggleFullscreen} label={t('player.fullscreen')}>
                {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
              </IconBtn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="rounded-full p-2 transition hover:bg-white/15">
      {children}
    </button>
  );
}

export function PlayerMessage({ icon, text, action }: { icon?: ReactNode; text: string; action?: ReactNode }) {
  return (
    <div className="grid h-dvh place-items-center bg-black px-6 text-center text-white">
      <div className="flex max-w-md flex-col items-center gap-4">
        {icon ?? <ShieldAlert className="size-12 text-amber-400" />}
        <p className="text-lg">{text}</p>
        {action}
      </div>
    </div>
  );
}
