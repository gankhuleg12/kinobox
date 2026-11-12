import i18n from '@/i18n';

export const formatPrice = (n: number) => `${n.toLocaleString('en-US')}₮`;

export function formatDuration(sec: number | null | undefined) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return i18n.language === 'en' ? (h ? `${h}h ${m}m` : `${m}m`) : h ? `${h}ц ${m}м` : `${m}м`;
}

export function formatClock(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

export function formatDate(iso: string | Date | null | undefined, withTime = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(i18n.language === 'en' ? 'en-US' : 'mn-MN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

/** Хэлнээс хамааран Монгол/Англи талбар сонгох */
export const pick = (mn: string | null | undefined, en: string | null | undefined) => (i18n.language === 'en' && en ? en : (mn ?? ''));

export function youtubeEmbed(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    let id: string | null = null;
    if (u.hostname === 'youtu.be') id = u.pathname.slice(1);
    else if (u.hostname.endsWith('youtube.com')) id = u.searchParams.get('v') ?? u.pathname.split('/').pop() ?? null;
    if (id && /^[\w-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
    if (u.hostname.endsWith('vimeo.com')) {
      const vid = u.pathname.split('/').filter(Boolean).pop();
      if (vid && /^\d+$/.test(vid)) return `https://player.vimeo.com/video/${vid}?autoplay=1`;
    }
  } catch {
    /* invalid */
  }
  return null;
}

export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');
