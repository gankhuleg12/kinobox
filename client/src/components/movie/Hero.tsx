import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Play, Info, Star, ChevronLeft, ChevronRight } from 'lucide-react';
import type { FeaturedMovie } from '@/types';
import { buttonClass, Skeleton } from '../ui';
import { Img } from './Img';
import { cn, formatDuration, pick } from '@/lib/format';

const DURATION = 7000;

/**
 * Нүүр хуудасны featured carousel.
 *  - Хулгана/хуруугаар чирж шилжүүлнэ (swipe, хурдан шидэлтийг танина), босоо scroll-д саад болохгүй
 *  - Desktop: баруун талд постер бүтнээрээ; backdrop байхгүй бол постерыг blur хийж дэвсгэр болгоно
 *  - Mobile: босоо постер нь бүтэн дэвсгэр
 *  - Автоматаар шилжинэ (hover/чирэх/табаас гарахад зогсоно), явц нь индикатор дээр харагдана
 */
export function Hero({ movies }: { movies: FeaturedMovie[] }) {
  const { t } = useTranslation();
  const count = movies.length;
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);

  const section = useRef<HTMLElement>(null);
  const progressBar = useRef<HTMLSpanElement>(null);
  const elapsed = useRef(0);
  const pausedRef = useRef(false);
  const pointer = useRef<{ id: number; x: number; y: number; t: number; axis: 'x' | 'y' | null } | null>(null);
  const suppressClick = useRef(false);

  pausedRef.current = hovered || dragging;

  const go = useCallback((delta: number) => {
    if (count < 2) return;
    elapsed.current = 0;
    setIndex((i) => (i + delta + count) % count);
  }, [count]);

  // Автомат шилжилт: rAF-аар хугацаа тоолж, progress bar-ыг DOM-оор шууд шинэчилнэ (re-render үгүй)
  useEffect(() => {
    if (count < 2) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (!pausedRef.current && !document.hidden) {
        elapsed.current += dt;
        if (elapsed.current >= DURATION) {
          elapsed.current = 0;
          setIndex((i) => (i + 1) % count);
        }
      }
      if (progressBar.current) progressBar.current.style.transform = `scaleX(${Math.min(1, elapsed.current / DURATION)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [count]);

  // ── Чирэх / swipe
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    suppressClick.current = false;
    pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), axis: null };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.axis) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      p.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (p.axis === 'x') {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }
    }
    if (p.axis === 'x') {
      suppressClick.current = true;
      setDrag(count > 1 ? dx : dx * 0.15); // нэг слайдтай бол уян эсэргүүцэл
    }
  };

  const endDrag = (e: ReactPointerEvent<HTMLElement>, cancelled = false) => {
    const p = pointer.current;
    pointer.current = null;
    if (p?.axis === 'x' && !cancelled) {
      const dx = e.clientX - p.x;
      const velocity = dx / Math.max(1, performance.now() - p.t); // px/ms
      const threshold = Math.min(120, (section.current?.clientWidth ?? 600) * 0.15);
      if (dx < -threshold || velocity < -0.45) go(1);
      else if (dx > threshold || velocity > 0.45) go(-1);
    }
    setDrag(0);
    setDragging(false);
  };

  if (!count) return null;
  const m = movies[index] ?? movies[0]!;
  const width = section.current?.clientWidth ?? 1200;
  const progress = Math.min(1, Math.abs(drag) / width);
  const neighbor = drag < 0 ? (index + 1) % count : drag > 0 ? (index - 1 + count) % count : -1;
  const glow = m.posterColor ?? 'var(--accent)';

  return (
    <section
      ref={section}
      aria-roledescription="carousel"
      aria-label="Featured"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(1);
        if (e.key === 'ArrowLeft') go(-1);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e)}
      onPointerCancel={(e) => endDrag(e, true)}
      onClickCapture={(e) => {
        // Чирсний дараах click-ийг (линк рүү орох) хаана
        if (suppressClick.current) {
          e.preventDefault();
          e.stopPropagation();
          suppressClick.current = false;
        }
      }}
      onDragStart={(e) => e.preventDefault()}
      className={cn('relative -mt-16 h-[80vh] min-h-[540px] w-full touch-pan-y overflow-hidden select-none sm:h-[86vh]', dragging ? 'cursor-grabbing' : 'cursor-grab')}
    >
      {/* ── Дэвсгэрүүд (crossfade + чирэхэд parallax) */}
      {movies.map((movie, i) => {
        const opacity = i === index ? 1 - progress * 0.7 : i === neighbor ? progress : 0;
        const shift = i === index ? drag * 0.25 : i === neighbor ? (drag < 0 ? width : -width) * 0.25 + drag * 0.25 : 0;
        return (
          <div
            key={movie.id}
            aria-hidden={i !== index}
            className={cn('absolute inset-0', !dragging && 'transition-[opacity,transform] duration-700 ease-out')}
            style={{ opacity, transform: `translateX(${shift}px)` }}
          >
            {/* Mobile: босоо постер бүтэн дэвсгэр */}
            <Img image={movie.poster ?? movie.backdrop} alt="" sizes="100vw" color={movie.posterColor} priority={i === 0} className="absolute inset-0 md:hidden" />
            {/* Desktop: backdrop, байхгүй бол постерыг blur хийнэ */}
            <div className="absolute inset-0 hidden md:block">
              {movie.backdrop ? (
                <Img image={movie.backdrop} alt="" sizes="100vw" color={movie.posterColor} priority={i === 0} className="absolute inset-0" />
              ) : (
                <Img image={movie.poster} alt="" sizes="50vw" color={movie.posterColor} priority={i === 0} className="absolute inset-0 scale-125 opacity-70 blur-2xl" />
              )}
            </div>
          </div>
        );
      })}

      {/* Уусах gradient-ууд */}
      <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-bg via-bg/40 to-bg/30 md:via-bg/10" />
      <div className="pointer-events-none absolute inset-0 hidden bg-linear-to-r from-bg via-bg/75 to-transparent md:block" />
      <div
        className="pointer-events-none absolute -bottom-40 left-1/4 h-96 w-[70%] rounded-full opacity-30 blur-3xl transition-colors duration-1000"
        style={{ background: glow }}
      />

      <div className="relative z-10 mx-auto flex h-full items-end gap-10 px-4 pb-32 sm:px-8 sm:pb-40 lg:px-12">
        {/* ── Текст */}
        <div
          key={m.id}
          className={cn('max-w-2xl flex-1 animate-fade-in', !dragging && 'transition-[transform,opacity] duration-500')}
          style={{ transform: `translateX(${drag * 0.6}px)`, opacity: 1 - progress * 1.2 }}
        >
          <h1 className="text-4xl leading-[1.05] font-extrabold tracking-tight text-balance drop-shadow-lg sm:text-6xl">{pick(m.title, m.titleEn)}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg/80">
            {m.imdbRating ? (
              <span className="flex items-center gap-1 font-semibold text-amber-500">
                <Star className="size-4 fill-current" /> {m.imdbRating.toFixed(1)}
              </span>
            ) : null}
            {m.releaseYear && <span>{m.releaseYear}</span>}
            {m.kind === 'SERIES' ? <span>{t('common.series')}</span> : m.durationSec ? <span>{formatDuration(m.durationSec)}</span> : null}
            {m.ageRating && <span className="rounded border border-line-strong px-1.5 text-xs">{m.ageRating}</span>}
          </div>
          <p className="mt-4 line-clamp-3 max-w-xl text-base leading-relaxed text-fg/80 sm:text-lg">{pick(m.description, m.descriptionEn)}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to={`/movie/${m.slug}`} draggable={false} className={buttonClass('primary', 'lg')}>
              <Play className="size-5 fill-current" /> {t('common.watch')}
            </Link>
            <Link to={`/movie/${m.slug}`} draggable={false} className={buttonClass('outline', 'lg', 'backdrop-blur')}>
              <Info className="size-5" /> {t('common.details')}
            </Link>
          </div>
        </div>

        {/* ── Desktop: постер бүтнээрээ, давамгай өнгөөр гэрэлтэнэ */}
        <Link
          key={`poster-${m.id}`}
          to={`/movie/${m.slug}`}
          draggable={false}
          aria-hidden
          tabIndex={-1}
          className={cn('glow-card mr-[3vw] ml-auto hidden w-56 shrink-0 animate-fade-in lg:block xl:w-64', !dragging && 'transition-transform duration-500')}
          style={{ '--glow': m.posterColor ?? undefined, transform: `translateX(${drag * 0.4}px) rotate(${drag * 0.01}deg)` } as CSSProperties}
        >
          <Img image={m.poster} alt="" sizes="256px" color={m.posterColor} priority className="aspect-2/3 rounded-2xl shadow-2xl ring-1 ring-white/10" />
        </Link>
      </div>

      {/* ── Индикатор + сум */}
      {count > 1 && (
        <div className="absolute inset-x-0 bottom-20 z-20 flex items-center justify-between gap-4 px-4 sm:bottom-28 sm:px-8 lg:px-12">
          <div className="flex items-center gap-2">
            {movies.map((movie, i) => (
              <button
                key={movie.id}
                onClick={() => {
                  elapsed.current = 0;
                  setIndex(i);
                }}
                aria-label={movie.title}
                aria-current={i === index}
                className={cn('relative h-1.5 overflow-hidden rounded-full transition-all duration-500', i === index ? 'w-12 bg-fg/20' : 'w-4 bg-fg/25 hover:bg-fg/50')}
              >
                {i === index && <span ref={progressBar} className="absolute inset-0 origin-left bg-gradient-brand" style={{ transform: 'scaleX(0)' }} />}
              </button>
            ))}
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <span className="mr-2 text-sm text-muted tabular-nums">
              {String(index + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
            </span>
            <button onClick={() => go(-1)} aria-label="Previous" className="grid size-10 place-items-center rounded-full border border-line-strong bg-surface/40 backdrop-blur transition hover:bg-surface/80">
              <ChevronLeft className="size-5" />
            </button>
            <button onClick={() => go(1)} aria-label="Next" className="grid size-10 place-items-center rounded-full border border-line-strong bg-surface/40 backdrop-blur transition hover:bg-surface/80">
              <ChevronRight className="size-5" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function HeroSkeleton() {
  return (
    <div className="relative -mt-16 flex h-[80vh] min-h-[540px] items-end gap-10 px-4 pb-32 sm:h-[86vh] sm:px-8 sm:pb-40 lg:px-12">
      <Skeleton className="absolute inset-0 rounded-none" />
      <div className="relative flex-1 space-y-4">
        <Skeleton className="h-14 w-2/3 max-w-lg bg-line-strong" />
        <Skeleton className="h-4 w-48 bg-line-strong" />
        <Skeleton className="h-16 w-full max-w-xl bg-line-strong" />
        <div className="flex gap-3">
          <Skeleton className="h-12 w-32 bg-line-strong" />
          <Skeleton className="h-12 w-36 bg-line-strong" />
        </div>
      </div>
      <Skeleton className="relative mr-[3vw] ml-auto hidden aspect-2/3 w-56 rounded-2xl bg-line-strong lg:block xl:w-64" />
    </div>
  );
}
