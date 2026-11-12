import { useEffect, useRef, useState } from 'react';
import { UploadCloud, RefreshCw, X, CheckCircle2, AlertTriangle, Hourglass } from 'lucide-react';
import { uploadVideo, type UploadHandle } from '@/lib/upload';
import { useFileDrop, isVideoFile } from '@/lib/useFileDrop';
import { Button, toast } from '@/components/ui';
import { cn } from '@/lib/format';
import { VideoBadge, adminApi, useAdminQuery } from './common';

export type VideoStatus = 'NONE' | 'UPLOADING' | 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';

interface Props {
  /** /admin/{movies|episodes|reels}/{id}/video */
  basePath: string;
  status: VideoStatus;
  progress: number;
  error: string | null;
  readyText?: string;
  hint: string;
  processingText: string;
  /** Төлөв өөрчлөгдсөн/шинэчлэх шаардлагатай үед (parent query-г invalidate хийнэ) */
  onChanged: () => void;
  compact?: boolean;
}

export interface WorkerStatus {
  online: boolean;
  heartbeat: { at: number; ffmpeg: { ok: boolean; error?: string }; ffprobe: { ok: boolean; error?: string } } | null;
  transcode: { waiting: number; active: number; delayed: number; failed: number };
}

/** Worker процесс эсвэл ffmpeg-гүй бол видео хэзээ ч боловсруулагдахгүй — тодорхой анхааруулна */
export function WorkerWarning({ enabled = true, className }: { enabled?: boolean; className?: string }) {
  const { data } = useAdminQuery<WorkerStatus>(['worker'], '/stats/worker', undefined, { enabled, refetchInterval: enabled ? 10_000 : false });
  if (!data) return null;
  if (!data.online) {
    return (
      <div className={cn('flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs', className)}>
        <AlertTriangle className="size-4 shrink-0 text-amber-500" />
        <div>
          <p className="font-semibold text-amber-600 dark:text-amber-400">Worker ажиллахгүй байна — видео боловсруулагдахгүй</p>
          <p className="mt-1 text-muted">
            Тусдаа terminal дээр: <code className="rounded bg-elevated px-1">npm --prefix server run dev:worker</code> (production: <code className="rounded bg-elevated px-1">worker</code> service)
          </p>
        </div>
      </div>
    );
  }
  const tool = !data.heartbeat?.ffmpeg.ok ? data.heartbeat?.ffmpeg : !data.heartbeat?.ffprobe.ok ? data.heartbeat?.ffprobe : null;
  if (tool) {
    return (
      <div className={cn('flex gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs', className)}>
        <AlertTriangle className="size-4 shrink-0 text-red-500" />
        <div>
          <p className="font-semibold text-red-500">ffmpeg/ffprobe олдсонгүй</p>
          <p className="mt-1 text-muted">server/.env дахь FFMPEG_PATH, FFPROBE_PATH-д бүтэн замыг бичээд worker-ийг дахин асаана уу. ({tool.error})</p>
        </div>
      </div>
    );
  }
  return null;
}

/** Кино, анги, reel-д дундын видео upload (сонгох эсвэл чирж оруулах) + transcode төлөвийн UI */
export function VideoUploader({ basePath, status, progress, error, readyText, hint, processingText, onChanged, compact }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const handle = useRef<UploadHandle | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const processing = status === 'QUEUED' || status === 'PROCESSING';

  // Боловсруулалт явж байхад төлөвийг тогтмол шинэчилнэ
  useEffect(() => {
    if (!processing) return;
    const id = window.setInterval(onChanged, 4000);
    return () => window.clearInterval(id);
  }, [processing, onChanged]);

  useEffect(() => () => handle.current?.cancel(), []);

  const start = async (file: File | undefined) => {
    if (!file) return;
    setUploadPct(0);
    handle.current = uploadVideo(basePath, file, setUploadPct);
    try {
      await handle.current.promise;
      toast.success('Upload дууслаа. Видео боловсруулалт эхэллээ.');
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) toast.error(err);
    } finally {
      handle.current = null;
      setUploadPct(null);
      if (input.current) input.current.value = '';
      onChanged();
    }
  };

  const { dragging, handlers } = useFileDrop((f) => void start(f), isVideoFile, {
    disabled: uploadPct !== null || processing,
    onReject: () => toast.error('Видео файл (MP4, MKV, MOV, WebM) оруулна уу'),
  });

  const retranscode = async () => {
    try {
      await adminApi(`${basePath.replace(/^\/admin/, '')}/retranscode`, { method: 'POST' });
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Видео</span>
        <VideoBadge status={status} progress={progress} />
      </div>

      {(processing || status === 'FAILED') && <WorkerWarning />}

      {uploadPct !== null ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span>R2 руу upload хийж байна…</span>
            <span className="tabular-nums">{uploadPct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-elevated">
            <div className="h-full bg-gradient-brand transition-all" style={{ width: `${uploadPct}%` }} />
          </div>
          <Button variant="outline" size="sm" icon={<X className="size-4" />} onClick={() => handle.current?.cancel()}>
            Цуцлах
          </Button>
        </div>
      ) : status === 'QUEUED' ? (
        <div className="flex items-center gap-3 rounded-xl bg-elevated/60 p-3 text-sm">
          <Hourglass className="size-4 shrink-0 animate-pulse text-accent" />
          <span>
            Дараалалд хүлээж байна…
            {error && <span className="mt-1 block text-xs text-muted">{error}</span>}
          </span>
        </div>
      ) : status === 'PROCESSING' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span>{processingText}</span>
            <span className="tabular-nums">{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-elevated">
            <div className="h-full bg-gradient-brand transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {status === 'READY' && readyText && (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4" /> {readyText}
            </p>
          )}
          {status === 'FAILED' && error && <p className="rounded-xl bg-red-500/10 p-3 text-xs text-red-500">{error}</p>}
          <button
            type="button"
            onClick={() => input.current?.click()}
            {...handlers}
            className={cn(
              'flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed text-center transition',
              compact ? 'px-4 py-6' : 'px-6 py-10',
              dragging ? 'scale-[1.01] border-accent bg-accent/10' : 'border-line-strong hover:border-accent/60 hover:bg-accent/5',
            )}
          >
            <UploadCloud className={cn('size-9 text-accent transition', dragging && 'animate-bounce')} />
            <span className="font-medium">
              {dragging ? 'Энд тавина уу' : status === 'READY' ? 'Видео солих' : 'Видео сонгох эсвэл энд чирж оруулах'}
            </span>
            <span className="text-xs text-muted">{hint}</span>
          </button>
          {(status === 'FAILED' || status === 'READY') && (
            <Button variant="outline" size="sm" icon={<RefreshCw className="size-4" />} onClick={() => void retranscode()}>
              Дахин боловсруулах
            </Button>
          )}
        </div>
      )}
      <input ref={input} type="file" accept="video/*,.mkv" hidden onChange={(e) => void start(e.target.files?.[0])} />
    </div>
  );
}
