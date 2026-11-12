import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Film, Eye, Search, X } from 'lucide-react';
import { Badge, Button, Field, Input, Modal, Select, Textarea, toast } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { AdminPage, MovieStatusBadge, Pager, VideoBadge, adminApi, useAdminMutation, useAdminQuery } from './common';
import { VideoUploader, type VideoStatus } from './VideoUploader';

interface ReelRow {
  id: string;
  caption: string | null;
  movieId: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  sortOrder: number;
  videoStatus: VideoStatus;
  videoProgress: number;
  videoError: string | null;
  durationSec: number | null;
  viewCount: number;
  createdAt: string;
  movie: { id: string; title: string; slug: string } | null;
  video: string | null;
  poster: string | null;
}

export default function ReelsAdmin() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<string | null>(null);
  const { data, isLoading } = useAdminQuery<{ items: ReelRow[]; total: number; pages: number }>(['reels'], '/reels', { status, page });
  const refresh = useCallback(() => void qc.invalidateQueries({ queryKey: ['admin', 'reels'] }), [qc]);

  const processing = data?.items.some((r) => r.videoStatus === 'QUEUED' || r.videoStatus === 'PROCESSING');
  useEffect(() => {
    if (!processing) return;
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [processing, refresh]);

  const create = useAdminMutation(() => adminApi<{ id: string }>('/reels', { method: 'POST', body: { status: 'DRAFT' } }), { invalidate: [['reels']] });

  return (
    <AdminPage
      title="Reels"
      subtitle="Босоо богино видео (3 мин хүртэл). Reel бүрээс холбогдсон кино руу шууд орно."
      actions={
        <Button icon={<Plus className="size-4" />} loading={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: (r) => setEditing(r.id) })}>
          Шинэ reel
        </Button>
      }
    >
      <Select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className="w-full sm:w-48">
        <option value="">Бүх төлөв</option>
        <option value="PUBLISHED">Нийтлэгдсэн</option>
        <option value="DRAFT">Ноорог</option>
        <option value="ARCHIVED">Архив</option>
      </Select>

      {!isLoading && !data?.items.length ? (
        <p className="rounded-2xl border border-dashed border-line-strong p-10 text-center text-sm text-muted">Reel алга. "Шинэ reel" дарж эхлээрэй.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {data?.items.map((r) => (
            <button key={r.id} onClick={() => setEditing(r.id)} className="group overflow-hidden rounded-2xl border border-line bg-surface text-left transition hover:border-accent/50">
              <div className="relative aspect-9/16 bg-elevated">
                {r.poster ? (
                  <img src={r.poster} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
                ) : (
                  <Film className="absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-1/2 text-subtle" />
                )}
                <div className="absolute inset-x-2 top-2 flex flex-wrap gap-1">
                  <MovieStatusBadge status={r.status} />
                  {r.videoStatus !== 'READY' && <VideoBadge status={r.videoStatus} progress={r.videoProgress} />}
                </div>
                <span className="absolute right-2 bottom-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                  <Eye className="size-3" /> {r.viewCount.toLocaleString()}
                </span>
              </div>
              <div className="p-2.5">
                <p className="truncate text-xs font-semibold">{r.movie?.title ?? <span className="text-subtle">Кино холбоогүй</span>}</p>
                <p className="mt-0.5 line-clamp-2 min-h-8 text-[11px] text-muted">{r.caption ?? '—'}</p>
              </div>
            </button>
          ))}
        </div>
      )}
      {data && <Pager page={page} pages={data.pages} total={data.total} onChange={setPage} />}

      <ReelModal reel={data?.items.find((r) => r.id === editing) ?? null} onClose={() => setEditing(null)} onChanged={refresh} />
    </AdminPage>
  );
}

function ReelModal({ reel, onClose, onChanged }: { reel: ReelRow | null; onClose: () => void; onChanged: () => void }) {
  const [form, setForm] = useState({ caption: '', movie: null as ReelRow['movie'], status: 'DRAFT' as ReelRow['status'], sortOrder: 0 });
  const [saving, setSaving] = useState(false);
  const remove = useAdminMutation((id: string) => adminApi(`/reels/${id}`, { method: 'DELETE' }), { success: 'Reel устгагдлаа', invalidate: [['reels']] });

  useEffect(() => {
    if (reel) setForm({ caption: reel.caption ?? '', movie: reel.movie, status: reel.status, sortOrder: reel.sortOrder });
  }, [reel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!reel) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (form.status === 'PUBLISHED' && reel.videoStatus !== 'READY') toast.info('Видео бэлэн болмогц reel хэрэглэгчдэд харагдана');
    setSaving(true);
    try {
      await adminApi(`/reels/${reel.id}`, {
        method: 'PATCH',
        body: { caption: form.caption.trim() || null, movieId: form.movie?.id ?? null, status: form.status, sortOrder: form.sortOrder },
      });
      toast.success('Хадгалагдлаа');
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Reel" wide>
      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <form onSubmit={save} className="space-y-4">
          <Field label="Холбогдох кино" hint="Reel дээрх 'Кино үзэх' товч энэ кино руу оруулна">
            <MoviePicker value={form.movie} onChange={(movie) => setForm((f) => ({ ...f, movie }))} />
          </Field>
          <Field label="Тайлбар">
            <Textarea value={form.caption} onChange={(e) => setForm((f) => ({ ...f, caption: e.target.value }))} maxLength={300} rows={3} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Төлөв">
              <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ReelRow['status'] }))}>
                <option value="DRAFT">Ноорог</option>
                <option value="PUBLISHED">Нийтлэгдсэн</option>
                <option value="ARCHIVED">Архив</option>
              </Select>
            </Field>
            <Field label="Дараалал" hint="Бага нь эхэнд">
              <Input type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) || 0 }))} />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <Button
              variant="ghost"
              className="text-red-500"
              icon={<Trash2 className="size-4" />}
              onClick={() => window.confirm('Энэ reel-ийг устгах уу?') && remove.mutate(reel.id, { onSuccess: onClose })}
            >
              Устгах
            </Button>
            <Button type="submit" loading={saving}>
              Хадгалах
            </Button>
          </div>
          <p className="text-xs text-subtle">Үүсгэсэн: {formatDate(reel.createdAt, true)}</p>
        </form>

        <div className="space-y-4">
          {reel.video && (
            <video src={reel.video} poster={reel.poster ?? undefined} controls muted playsInline className="aspect-9/16 w-full rounded-2xl bg-black object-contain" />
          )}
          <VideoUploader
            basePath={`/admin/reels/${reel.id}/video`}
            status={reel.videoStatus}
            progress={reel.videoProgress}
            error={reel.videoError}
            readyText={reel.durationSec ? `Бэлэн · ${reel.durationSec} сек` : 'Бэлэн'}
            hint="Босоо (9:16) видео · 2GB хүртэл · 3 мин хүртэл хэсэг хадгалагдана"
            processingText="720p MP4 болгож, CDN руу байршуулж байна…"
            onChanged={onChanged}
            compact
          />
        </div>
      </div>
    </Modal>
  );
}

/** Кино хайж сонгох (debounce-тэй) */
function MoviePicker({ value, onChange }: { value: ReelRow['movie']; onChange: (m: ReelRow['movie']) => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(id);
  }, [q]);
  const { data } = useAdminQuery<{ items: { id: string; title: string; slug: string; status: string; kind: string }[] }>(
    ['movie-picker'],
    '/movies',
    { q: debounced, limit: 8 },
    { enabled: open },
  );

  if (value) {
    return (
      <div className="flex h-11 items-center justify-between gap-2 rounded-xl border border-line-strong bg-surface px-3.5">
        <span className="truncate text-sm font-medium">{value.title}</span>
        <button type="button" onClick={() => onChange(null)} className="text-muted hover:text-fg" aria-label="Цэвэрлэх">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
      <Input
        value={q}
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder="Киноны нэрээр хайх…"
        className="pl-9"
      />
      {open && data && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-2xl">
          {data.items.length === 0 && <li className="px-3 py-2 text-sm text-muted">Олдсонгүй</li>}
          {data.items.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (onChange({ id: m.id, title: m.title, slug: m.slug }), setQ(''), setOpen(false))}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-elevated"
              >
                <span className="truncate">{m.title}</span>
                <span className="flex shrink-0 gap-1">
                  {m.kind === 'SERIES' && <Badge tone="accent">Цуврал</Badge>}
                  {m.status !== 'PUBLISHED' && <Badge>{m.status}</Badge>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
