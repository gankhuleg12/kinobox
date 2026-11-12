import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, ImagePlus, Gift } from 'lucide-react';
import { Badge, Button, Field, Input, Modal, Switch, Textarea, toast } from '@/components/ui';
import { Img } from '@/components/movie/Img';
import { formatDuration } from '@/lib/format';
import type { ImageSet } from '@/types';
import { Card, VideoBadge, adminApi, useAdminMutation, useAdminQuery } from './common';
import { VideoUploader, type VideoStatus } from './VideoUploader';
import { useFileDrop, isImageFile } from '@/lib/useFileDrop';

interface EpisodeRow {
  id: string;
  movieId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string | null;
  titleEn: string | null;
  description: string | null;
  durationSec: number | null;
  isPublished: boolean;
  videoStatus: VideoStatus;
  videoProgress: number;
  videoError: string | null;
  renditions: { name: string; height: number }[] | null;
  still: ImageSet | null;
  isFree: boolean;
}

/** Цувралын ангиуд: нэмэх, засах, зураг, видео upload, нийтлэх */
export function EpisodesManager({ movieId, fallbackStill }: { movieId: string; fallbackStill: string | null }) {
  const qc = useQueryClient();
  const key = ['episodes', movieId];
  const { data: episodes, isLoading } = useAdminQuery<EpisodeRow[]>(key, '/episodes', { movieId });
  const refresh = useCallback(() => void qc.invalidateQueries({ queryKey: ['admin', 'episodes', movieId] }), [qc, movieId]);
  const [editing, setEditing] = useState<string | null>(null);

  const last = episodes?.at(-1);
  const [form, setForm] = useState({ seasonNumber: 1, episodeNumber: 1, title: '' });
  useEffect(() => {
    if (last) setForm((f) => ({ ...f, seasonNumber: last.seasonNumber, episodeNumber: last.episodeNumber + 1 }));
  }, [last?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Аль нэг анги боловсруулагдаж байвал жагсаалтыг шинэчилнэ
  const processing = episodes?.some((e) => e.videoStatus === 'QUEUED' || e.videoStatus === 'PROCESSING');
  useEffect(() => {
    if (!processing) return;
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [processing, refresh]);

  const create = useAdminMutation(
    (body: typeof form) => adminApi<{ id: string }>('/episodes', { method: 'POST', body: { movieId, ...body, title: body.title.trim() || null } }),
    { success: 'Анги нэмэгдлээ', invalidate: [key] },
  );
  const patch = useAdminMutation(({ id, ...body }: { id: string } & Record<string, unknown>) => adminApi(`/episodes/${id}`, { method: 'PATCH', body }), {
    invalidate: [key],
  });
  const remove = useAdminMutation((id: string) => adminApi(`/episodes/${id}`, { method: 'DELETE' }), { success: 'Анги устгагдлаа', invalidate: [key] });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(form, { onSuccess: (res) => (setForm((f) => ({ ...f, episodeNumber: f.episodeNumber + 1, title: '' })), setEditing(res.id)) });
  };

  const current = episodes?.find((e) => e.id === editing) ?? null;

  return (
    <Card title={`Ангиуд (${episodes?.length ?? 0})`}>
      <form onSubmit={submit} className="mb-5 grid grid-cols-[80px_80px_1fr_auto] items-end gap-2">
        <Field label="Улирал">
          <Input type="number" min={1} value={form.seasonNumber} onChange={(e) => setForm((f) => ({ ...f, seasonNumber: Number(e.target.value) || 1 }))} />
        </Field>
        <Field label="Анги">
          <Input type="number" min={1} value={form.episodeNumber} onChange={(e) => setForm((f) => ({ ...f, episodeNumber: Number(e.target.value) || 1 }))} />
        </Field>
        <Field label="Гарчиг (заавал биш)">
          <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} maxLength={200} />
        </Field>
        <Button type="submit" loading={create.isPending} icon={<Plus className="size-4" />}>
          Нэмэх
        </Button>
      </form>

      {isLoading ? null : !episodes?.length ? (
        <p className="rounded-xl bg-elevated/60 p-4 text-sm text-muted">Анги алга. Дээрх хэсгээс анги нэмээд видеог нь upload хийнэ үү.</p>
      ) : (
        <ul className="divide-y divide-line">
          {episodes.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2.5">
              <Img image={e.still} alt="" sizes="96px" color={fallbackStill} className="aspect-video w-24 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  <span className="text-muted">S{e.seasonNumber}:E{e.episodeNumber}</span> {e.title ?? ''}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <VideoBadge status={e.videoStatus} progress={e.videoProgress} />
                  {e.isFree && (
                    <Badge tone="success">
                      <Gift className="size-3" /> Үнэгүй
                    </Badge>
                  )}
                  {!e.isPublished && <Badge>Нуугдсан</Badge>}
                  {e.durationSec ? <span className="text-xs text-muted">{formatDuration(e.durationSec)}</span> : null}
                </div>
              </div>
              <Switch checked={e.isPublished} onChange={(v) => patch.mutate({ id: e.id, isPublished: v })} />
              <Button size="sm" variant="ghost" aria-label="Засах" onClick={() => setEditing(e.id)}>
                <Pencil className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" aria-label="Устгах" onClick={() => window.confirm(`S${e.seasonNumber}:E${e.episodeNumber} ангийг устгах уу?`) && remove.mutate(e.id)}>
                <Trash2 className="size-4 text-red-500" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-subtle">"Үнэгүй" тэмдэг нь кино дээр тохируулсан "эхний N анги үнэгүй" дүрмээр (зөвхөн нийтлэгдсэн ангиудын дарааллаар) автоматаар тооцогдоно.</p>

      <EpisodeModal episode={current} onClose={() => setEditing(null)} onChanged={refresh} fallbackStill={fallbackStill} />
    </Card>
  );
}

function EpisodeModal({ episode, onClose, onChanged, fallbackStill }: { episode: EpisodeRow | null; onClose: () => void; onChanged: () => void; fallbackStill: string | null }) {
  const [form, setForm] = useState({ seasonNumber: 1, episodeNumber: 1, title: '', titleEn: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (episode)
      setForm({
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        title: episode.title ?? '',
        titleEn: episode.titleEn ?? '',
        description: episode.description ?? '',
      });
  }, [episode?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { dragging, handlers } = useFileDrop((f) => void uploadStill(f), isImageFile, {
    disabled: uploading || !episode,
    onReject: () => toast.error('JPEG, PNG, WebP эсвэл AVIF зураг оруулна уу'),
  });

  if (!episode) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await adminApi(`/episodes/${episode.id}`, {
        method: 'PATCH',
        body: { ...form, title: form.title.trim() || null, titleEn: form.titleEn.trim() || null, description: form.description.trim() || null },
      });
      toast.success('Хадгалагдлаа');
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  async function uploadStill(file: File | undefined) {
    if (!file || !episode) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await adminApi(`/episodes/${episode.id}/still`, { method: 'POST', body: fd });
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <Modal open onClose={onClose} title={`S${episode.seasonNumber}:E${episode.episodeNumber} анги`} wide>
      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Улирал">
              <Input type="number" min={1} value={form.seasonNumber} onChange={(e) => setForm((f) => ({ ...f, seasonNumber: Number(e.target.value) || 1 }))} />
            </Field>
            <Field label="Анги">
              <Input type="number" min={1} value={form.episodeNumber} onChange={(e) => setForm((f) => ({ ...f, episodeNumber: Number(e.target.value) || 1 }))} />
            </Field>
          </div>
          <Field label="Гарчиг (MN)">
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} maxLength={200} />
          </Field>
          <Field label="Гарчиг (EN)">
            <Input value={form.titleEn} onChange={(e) => setForm((f) => ({ ...f, titleEn: e.target.value }))} maxLength={200} />
          </Field>
          <Field label="Тайлбар">
            <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} maxLength={3000} rows={4} />
          </Field>
          <Button type="submit" loading={saving}>
            Хадгалах
          </Button>
        </form>

        <div className="space-y-6">
          <div>
            <p className="mb-2 text-sm font-medium">Ангийн зураг (16:9)</p>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              {...handlers}
              className={`group relative block w-full overflow-hidden rounded-xl ring-2 transition ${dragging ? 'ring-accent' : 'ring-transparent'}`}
            >
              {episode.still ? (
                <Img image={episode.still} alt="" sizes="400px" color={fallbackStill} className="aspect-video w-full" />
              ) : (
                <div className="grid aspect-video w-full place-items-center bg-elevated text-subtle">
                  <ImagePlus className="size-8" />
                </div>
              )}
              <span
                className={`absolute inset-0 grid place-items-center text-sm font-medium text-white transition ${dragging ? 'bg-accent/60 opacity-100' : uploading ? 'bg-black/50 opacity-100' : 'bg-black/50 opacity-0 group-hover:opacity-100'}`}
              >
                {uploading ? 'Хуулж байна…' : dragging ? 'Энд тавина уу' : 'Солих эсвэл чирж оруулах'}
              </span>
            </button>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden onChange={(e) => void uploadStill(e.target.files?.[0])} />
          </div>
          <VideoUploader
            basePath={`/admin/episodes/${episode.id}/video`}
            status={episode.videoStatus}
            progress={episode.videoProgress}
            error={episode.videoError}
            readyText={`Бэлэн: ${episode.renditions?.map((r) => r.name).join(', ') ?? ''}${episode.durationSec ? ` · ${formatDuration(episode.durationSec)}` : ''}`}
            hint="MP4, MKV, MOV, WebM · 30GB хүртэл"
            processingText="HLS (AES-128) болгож байна…"
            onChanged={onChanged}
            compact
          />
        </div>
      </div>
    </Modal>
  );
}
