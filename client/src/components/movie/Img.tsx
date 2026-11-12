import { useState } from 'react';
import { Film } from 'lucide-react';
import type { ImageSet } from '@/types';
import { cn } from '@/lib/format';

interface Props {
  image: ImageSet | null;
  alt: string;
  sizes: string;
  color?: string | null;
  className?: string;
  priority?: boolean;
}

/**
 * Responsive, lazy-loaded зураг. Ачаалагдах хүртэл poster-ийн давамгай өнгийг
 * placeholder болгож, ачаалсны дараа зөөлөн fade-in хийнэ (layout shift үгүй).
 */
export function Img({ image, alt, sizes, color, className, priority }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const bg = color ? `linear-gradient(160deg, ${color}, color-mix(in oklab, ${color} 40%, #000))` : undefined;
  // Дуудагч absolute/fixed өгсөн бол relative нэмэхгүй (хоёулаа байвал CSS дарааллаар relative ялж өндөр 0 болно)
  const positioned = /(^|\s)(absolute|fixed)(\s|$)/.test(className ?? '');

  return (
    <div className={cn(!positioned && 'relative', 'overflow-hidden bg-elevated', className)} style={{ background: bg }}>
      {image && !failed ? (
        <img
          src={image.src}
          srcSet={image.srcSet}
          sizes={sizes}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn('absolute inset-0 size-full object-cover transition-opacity duration-500', loaded ? 'opacity-100' : 'opacity-0')}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-linear-to-br from-accent/25 via-elevated to-accent-2/20">
          <Film className="size-8 text-fg/30" />
        </div>
      )}
    </div>
  );
}
