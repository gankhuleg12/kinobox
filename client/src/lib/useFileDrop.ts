import { useRef, useState, type DragEvent } from 'react';

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

export const isVideoFile = (f: File) => f.type.startsWith('video/') || /\.(mp4|mkv|mov|webm|avi|m4v)$/i.test(f.name);
export const isImageFile = (f: File) => /^image\/(jpeg|png|webp|avif)$/.test(f.type);

/**
 * Файл чирж оруулах (drag & drop). Элементэд `{...handlers}` тавихад хангалттай.
 * Дотоод элемент дээгүүр чирэхэд анивчихгүйн тулд enter/leave-ийн гүнийг тоолно.
 */
export function useFileDrop(onFile: (file: File) => void, accept: (file: File) => boolean, opts: { disabled?: boolean; onReject?: (file: File) => void } = {}) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const handlers = {
    onDragEnter(e: DragEvent) {
      if (opts.disabled || !hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver(e: DragEvent) {
      if (opts.disabled || !hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave(e: DragEvent) {
      if (opts.disabled || !hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop(e: DragEvent) {
      if (opts.disabled || !hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      if (accept(file)) onFile(file);
      else opts.onReject?.(file);
    },
  };

  return { dragging, handlers };
}
