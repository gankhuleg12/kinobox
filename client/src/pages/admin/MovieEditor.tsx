import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ImagePlus, ExternalLink } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { Button, ButtonLink, Field, Input, PageSpinner, Select, Switch, Textarea, toast } from '@/components/ui';
import { Img } from '@/components/movie/Img';
import { cn, formatDuration } from '@/lib/format';
import type { ImageSet } from '@/types';
import { AdminPage, Card, adminApi, useAdminQuery } from './common';
import { VideoUploader } from './VideoUploader';
import { useFileDrop, isImageFile } from '@/lib/useFileDrop';
import { EpisodesManager } from './EpisodesManager';

type VideoStatus = 'NONE' | 'UPLOADING' | 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';
interface MovieAdmin {
  id: string;
  slug: string;
  title: string;
  titleEn: string | null;
  description: string;
  descriptionEn: string | null;
  releaseYear: number | null;
  durationSec: number | null;
  ageRating: string | null;
  imdbRating: number | null;
  country: string | null;
  director: string | null;
  cast: string | null;
  trailerUrl: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  isFeatured: boolean;
  accessType: 'SUBSCRIPTION' | 'RENT_ONLY' | 'FREE';
  rentPrice: number | null;
  rentHours: number | null;
  fbCode: string | null;
  categoryIds: number[];
  kind: 'MOVIE' | 'SERIES';
  freeEpisodes: number;
  poster: ImageSet | null;
  posterColor: string | null;
  backdrop: string | null;
  videoStatus: VideoStatus;
  videoProgress: number;
  videoError: string | null;
  renditions: { name: string; height: number }[] | null;
}
interface CategoryRow {
  id: number;
  nameMn: string;
}

type Form = Omit<MovieAdmin, 'id' | 'poster' | 'posterColor' | 'backdrop' | 'videoStatus' | 'videoProgress' | 'videoError' | 'renditions'>;

const empty: Form = {
  slug: '',
  title: '',
  titleEn: '',
  description: '',
  descriptionEn: '',
  releaseYear: null,
  durationSec: null,
  ageRating: '',
  imdbRating: null,
  country: '',
  director: '',
  cast: '',
  trailerUrl: '',
  status: 'DRAFT',
  isFeatured: false,
  accessType: 'SUBSCRIPTION',
  rentPrice: null,
  rentHours: null,
  fbCode: '',
  categoryIds: [],
  kind: 'MOVIE',
  freeEpisodes: 0,
};

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

export default function MovieEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: movie, isLoading } = useAdminQuery<MovieAdmin>(['movie', id], `/movies/${id}`, undefined, { enabled: !isNew });
  const { data: categories } = useAdminQuery<CategoryRow[]>(['categories'], '/categories');
  const [form, setForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (movie) {
      const { id: _i, poster: _p, posterColor: _c, backdrop: _b, videoStatus: _v, videoProgress: _vp, videoError: _ve, renditions: _r, ...rest } = movie;
      setForm({ ...empty, ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v ?? (typeof empty[k as keyof Form] === 'string' ? '' : v)])) } as Form);
    }
  }, [movie]);

  if (!isNew && (isLoading || !movie)) return <PageSpinner />;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const str = (v: string | null) => (v && v.trim() ? v.trim() : null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const body = {
      title: form.title,
      titleEn: str(form.titleEn),
      ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
      description: form.description,
      descriptionEn: str(form.descriptionEn),
      releaseYear: form.releaseYear,
      durationSec: form.durationSec,
      ageRating: str(form.ageRating),
      imdbRating: form.imdbRating,
      country: str(form.country),
      director: str(form.director),
      cast: str(form.cast),
      trailerUrl: str(form.trailerUrl) ?? '',
      status: form.status,
      isFeatured: form.isFeatured,
      accessType: form.accessType,
      rentPrice: form.rentPrice,
      rentHours: form.rentHours,
      fbCode: str(form.fbCode),
      categoryIds: form.categoryIds,
      kind: form.kind,
      freeEpisodes: form.kind === 'SERIES' ? form.freeEpisodes : 0,
    };
    try {
      const res = await adminApi<{ id: string }>(isNew ? '/movies' : `/movies/${id}`, { method: isNew ? 'POST' : 'PATCH', body });
      toast.success('Хадгалагдлаа');
      void qc.invalidateQueries({ queryKey: ['admin', 'movies'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'movie'] });
      if (isNew) navigate(`/admin/movies/${res.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        setErrors(Object.fromEntries((err.details as { path: string; message: string }[]).map((d) => [d.path, d.message])));
      }
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminPage
      title={isNew ? 'Шинэ кино' : movie!.title}
      actions={
        <>
          <Button variant="ghost" onClick={() => navigate('/admin/movies')} icon={<ArrowLeft className="size-4" />}>
            Буцах
          </Button>
          {!isNew && movie!.status === 'PUBLISHED' && (
            <ButtonLink to={`/movie/${movie!.slug}`} target="_blank" variant="outline">
              <ExternalLink className="size-4" /> Сайтад харах
            </ButtonLink>
          )}
        </>
      }
    >
      <form onSubmit={save} className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title="Үндсэн мэдээлэл">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Гарчиг (MN) *" error={errors.title}>
                <Input required value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={200} />
              </Field>
              <Field label="Гарчиг (EN)" error={errors.titleEn}>
                <Input value={form.titleEn ?? ''} onChange={(e) => set('titleEn', e.target.value)} maxLength={200} />
              </Field>
              <Field label="URL slug" hint="Хоосон бол гарчгаас автоматаар үүснэ" error={errors.slug} className="sm:col-span-2">
                <Input value={form.slug} onChange={(e) => set('slug', e.target.value.toLowerCase())} placeholder="jishee-kino" maxLength={160} />
              </Field>
              <Field label="Тайлбар (MN) *" error={errors.description} className="sm:col-span-2">
                <Textarea required value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={5000} rows={5} />
              </Field>
              <Field label="Тайлбар (EN)" className="sm:col-span-2">
                <Textarea value={form.descriptionEn ?? ''} onChange={(e) => set('descriptionEn', e.target.value)} maxLength={5000} rows={3} />
              </Field>
              <Field label="Он" error={errors.releaseYear}>
                <Input type="number" value={form.releaseYear ?? ''} onChange={(e) => set('releaseYear', numOrNull(e.target.value))} min={1888} max={2100} />
              </Field>
              <Field label="Үргэлжлэх хугацаа (минут)" hint="Видео боловсруулахад автоматаар тодорхойлогдоно">
                <Input
                  type="number"
                  value={form.durationSec ? Math.round(form.durationSec / 60) : ''}
                  onChange={(e) => set('durationSec', e.target.value ? Number(e.target.value) * 60 : null)}
                  min={0}
                />
              </Field>
              <Field label="Насны ангилал">
                <Input value={form.ageRating ?? ''} onChange={(e) => set('ageRating', e.target.value)} placeholder="13+" maxLength={10} />
              </Field>
              <Field label="IMDb үнэлгээ">
                <Input type="number" step="0.1" min={0} max={10} value={form.imdbRating ?? ''} onChange={(e) => set('imdbRating', numOrNull(e.target.value))} />
              </Field>
              <Field label="Улс">
                <Input value={form.country ?? ''} onChange={(e) => set('country', e.target.value)} maxLength={80} />
              </Field>
              <Field label="Найруулагч">
                <Input value={form.director ?? ''} onChange={(e) => set('director', e.target.value)} maxLength={160} />
              </Field>
              <Field label="Жүжигчид" className="sm:col-span-2">
                <Input value={form.cast ?? ''} onChange={(e) => set('cast', e.target.value)} maxLength={500} placeholder="Нэр 1, Нэр 2, …" />
              </Field>
              <Field label="Трейлер (YouTube/Vimeo)" error={errors.trailerUrl} className="sm:col-span-2">
                <Input type="url" value={form.trailerUrl ?? ''} onChange={(e) => set('trailerUrl', e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
              </Field>
            </div>
          </Card>

          <Card title="Ангилал">
            <div className="flex flex-wrap gap-2">
              {categories?.map((c) => {
                const on = form.categoryIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => set('categoryIds', on ? form.categoryIds.filter((x) => x !== c.id) : [...form.categoryIds, c.id])}
                    className={cn('rounded-full border px-3 py-1.5 text-sm transition', on ? 'border-transparent bg-gradient-brand text-white' : 'border-line-strong text-muted hover:text-fg')}
                  >
                    {c.nameMn}
                  </button>
                );
              })}
            </div>
          </Card>

          {!isNew && <MediaSection movie={movie!} />}
        </div>

        <div className="space-y-6">
          <Card title="Төрөл">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {(['MOVIE', 'SERIES'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => set('kind', k)}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 text-sm font-semibold transition',
                      form.kind === k ? 'border-transparent bg-gradient-brand text-white' : 'border-line-strong text-muted hover:text-fg',
                    )}
                  >
                    {k === 'MOVIE' ? 'Кино' : 'Олон ангит'}
                  </button>
                ))}
              </div>
              {form.kind === 'SERIES' && (
                <Field label="Эхний хэдэн анги үнэгүй вэ?" hint="0 бол бүх анги түрээс/багцаар. Нэвтэрсэн хэрэглэгч үнэгүй ангийг шууд үзнэ." error={errors.freeEpisodes}>
                  <Input type="number" min={0} max={500} value={form.freeEpisodes} onChange={(e) => set('freeEpisodes', Math.max(0, Number(e.target.value) || 0))} />
                </Field>
              )}
              {!isNew && movie!.kind !== form.kind && <p className="text-xs text-amber-500">Хадгалсны дараа {form.kind === 'SERIES' ? 'ангиудын' : 'видео'} хэсэг гарна.</p>}
            </div>
          </Card>

          <Card title="Нийтлэх">
            <div className="space-y-4">
              <Field label="Төлөв">
                <Select value={form.status} onChange={(e) => set('status', e.target.value as Form['status'])}>
                  <option value="DRAFT">Ноорог</option>
                  <option value="PUBLISHED">Нийтлэгдсэн</option>
                  <option value="ARCHIVED">Архив</option>
                </Select>
              </Field>
              <Switch checked={form.isFeatured} onChange={(v) => set('isFeatured', v)} label="Нүүр хуудсанд онцлох (featured)" />
              <Button type="submit" className="w-full" loading={saving}>
                {isNew ? 'Үүсгэх' : 'Хадгалах'}
              </Button>
            </div>
          </Card>

          <Card title="Хандалт & үнэ">
            <div className="space-y-4">
              <Field label="Хандалтын төрөл">
                <Select value={form.accessType} onChange={(e) => set('accessType', e.target.value as Form['accessType'])}>
                  <option value="SUBSCRIPTION">Сарын багц эсвэл түрээс</option>
                  <option value="RENT_ONLY">Зөвхөн түрээс</option>
                  <option value="FREE">Үнэгүй</option>
                </Select>
              </Field>
              {form.accessType !== 'FREE' && (
                <>
                  <Field label="Түрээсийн үнэ (₮)" hint="Хоосон бол үндсэн үнэ хэрэглэгдэнэ" error={errors.rentPrice}>
                    <Input type="number" min={0} value={form.rentPrice ?? ''} onChange={(e) => set('rentPrice', numOrNull(e.target.value))} />
                  </Field>
                  <Field label="Түрээсийн хугацаа (цаг)" hint="Хоосон бол үндсэн хугацаа">
                    <Input type="number" min={1} value={form.rentHours ?? ''} onChange={(e) => set('rentHours', numOrNull(e.target.value))} />
                  </Field>
                </>
              )}
            </div>
          </Card>

          <Card title="Facebook Messenger код">
            <Field label="Код" hint='Пост дээр "1 гэж comment бичээрэй" гэвэл энд 1 гэж оруулна' error={errors.fbCode}>
              <Input value={form.fbCode ?? ''} onChange={(e) => set('fbCode', e.target.value.toUpperCase())} placeholder="1" maxLength={20} className="font-mono text-lg font-bold" />
            </Field>
          </Card>
        </div>
      </form>
    </AdminPage>
  );
}

function MediaSection({ movie }: { movie: MovieAdmin }) {
  const qc = useQueryClient();
  const refresh = useCallback(() => void qc.invalidateQueries({ queryKey: ['admin', 'movie', movie.id] }), [qc, movie.id]);

  return (
    <>
      <Card title="Зураг">
        <div className="grid gap-6 sm:grid-cols-[160px_1fr]">
          <ImageUpload kind="poster" movieId={movie.id} onDone={refresh} label="Постер (2:3)">
            <Img image={movie.poster} alt="" sizes="160px" color={movie.posterColor} className="aspect-2/3 w-full rounded-xl" />
          </ImageUpload>
          <ImageUpload kind="backdrop" movieId={movie.id} onDone={refresh} label="Арын зураг (16:9)">
            {movie.backdrop ? (
              <img src={movie.backdrop} alt="" className="aspect-video w-full rounded-xl object-cover" />
            ) : (
              <div className="grid aspect-video w-full place-items-center rounded-xl bg-elevated text-subtle">
                <ImagePlus className="size-8" />
              </div>
            )}
          </ImageUpload>
        </div>
        <p className="mt-4 text-xs text-subtle">JPEG/PNG/WebP/AVIF, 15MB хүртэл. Олон хэмжээтэй WebP болгон автоматаар хөрвүүлнэ.</p>
      </Card>
      {movie.kind === 'SERIES' ? (
        <EpisodesManager movieId={movie.id} fallbackStill={movie.posterColor} />
      ) : (
        <Card>
          <VideoUploader
            basePath={`/admin/movies/${movie.id}/video`}
            status={movie.videoStatus}
            progress={movie.videoProgress}
            error={movie.videoError}
            readyText={`Бэлэн: ${movie.renditions?.map((r) => r.name).join(', ') ?? ''}${movie.durationSec ? ` · ${formatDuration(movie.durationSec)}` : ''}`}
            hint="MP4, MKV, MOV, WebM · 60GB хүртэл · Browser-оос шууд R2 руу"
            processingText="ffmpeg-ээр HLS (360p–1080p, AES-128 шифрлэлттэй) болгож байна…"
            onChanged={refresh}
          />
        </Card>
      )}
    </>
  );
}

function ImageUpload({ kind, movieId, onDone, label, children }: { kind: 'poster' | 'backdrop'; movieId: string; onDone: () => void; label: string; children: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await adminApi(`/movies/${movieId}/${kind}`, { method: 'POST', body: fd });
      toast.success('Зураг шинэчлэгдлээ');
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const { dragging, handlers } = useFileDrop((f) => void onFile(f), isImageFile, {
    disabled: busy,
    onReject: () => toast.error('JPEG, PNG, WebP эсвэл AVIF зураг оруулна уу'),
  });

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted">{label}</p>
      <button
        type="button"
        onClick={() => input.current?.click()}
        {...handlers}
        className={cn('group relative block w-full overflow-hidden rounded-xl ring-2 transition', dragging ? 'ring-accent' : 'ring-transparent')}
        disabled={busy}
      >
        {children}
        <span
          className={cn(
            'absolute inset-0 grid place-items-center px-2 text-center text-sm font-medium text-white transition',
            dragging ? 'bg-accent/60 opacity-100' : busy ? 'bg-black/50 opacity-100' : 'bg-black/50 opacity-0 group-hover:opacity-100',
          )}
        >
          {busy ? 'Хуулж байна…' : dragging ? 'Энд тавина уу' : 'Солих эсвэл чирж оруулах'}
        </span>
      </button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
    </div>
  );
}
