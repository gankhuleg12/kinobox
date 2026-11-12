import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Plus, Search, Star, Trash2 } from 'lucide-react';
import { Badge, Button, ButtonLink, Input, Select } from '@/components/ui';
import { Img } from '@/components/movie/Img';
import { formatPrice } from '@/lib/format';
import type { ImageSet } from '@/types';
import { AdminPage, MovieStatusBadge, Pager, Table, Td, VideoBadge, adminApi, useAdminMutation, useAdminQuery, FilterBar } from './common';

interface Row {
  id: string;
  slug: string;
  title: string;
  releaseYear: number | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  isFeatured: boolean;
  accessType: 'SUBSCRIPTION' | 'RENT_ONLY' | 'FREE';
  rentPrice: number | null;
  fbCode: string | null;
  kind: 'MOVIE' | 'SERIES';
  freeEpisodes: number;
  episodeCount: number;
  videoStatus: 'NONE' | 'UPLOADING' | 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';
  videoProgress: number;
  poster: ImageSet | null;
  posterColor: string | null;
  viewCount: number;
}

export default function Movies() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useAdminQuery<{ items: Row[]; total: number; pages: number }>(['movies'], '/movies', { q, status, page }, { refetchInterval: 10_000 });
  const del = useAdminMutation((id: string) => adminApi(`/movies/${id}`, { method: 'DELETE' }), { success: 'Устгагдлаа', invalidate: [['movies']] });

  return (
    <AdminPage
      title="Кино"
      subtitle="Кино нэмэх, засах, видео upload хийх, Facebook код тохируулах"
      actions={
        <ButtonLink to="/admin/movies/new">
          <Plus className="size-4" /> Шинэ кино
        </ButtonLink>
      }
    >
      <FilterBar>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input placeholder="Нэр, slug, FB код…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="pl-9" />
        </div>
        <Select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className="sm:w-44">
          <option value="">Бүх төлөв</option>
          <option value="PUBLISHED">Нийтлэгдсэн</option>
          <option value="DRAFT">Ноорог</option>
          <option value="ARCHIVED">Архив</option>
        </Select>
      </FilterBar>

      <Table head={['Кино', 'Төлөв', 'Видео', 'Хандалт / үнэ', 'FB код', 'Үзэлт', '']} empty={!isLoading && !data?.items.length}>
        {data?.items.map((m) => (
          <tr key={m.id} className="cursor-pointer transition hover:bg-elevated/50" onClick={() => navigate(`/admin/movies/${m.id}`)}>
            <Td>
              <div className="flex items-center gap-3">
                <Img image={m.poster} alt="" sizes="40px" color={m.posterColor} className="aspect-2/3 w-10 shrink-0 rounded-md" />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate font-medium">
                    {m.title} {m.isFeatured && <Star className="size-3.5 fill-amber-400 text-amber-400" />}
                  </p>
                  <p className="text-xs text-muted">{m.releaseYear ?? '—'} · /{m.slug}</p>
                </div>
              </div>
            </Td>
            <Td>
              <MovieStatusBadge status={m.status} />
            </Td>
            <Td>
              {m.kind === 'SERIES' ? (
                <span className="text-xs">
                  <Badge tone="accent">Цуврал</Badge> <span className="text-muted">{m.episodeCount} анги{m.freeEpisodes ? ` · ${m.freeEpisodes} үнэгүй` : ''}</span>
                </span>
              ) : (
                <VideoBadge status={m.videoStatus} progress={m.videoProgress} />
              )}
            </Td>
            <Td className="text-xs">
              <p>{{ SUBSCRIPTION: 'Багц + түрээс', RENT_ONLY: 'Зөвхөн түрээс', FREE: 'Үнэгүй' }[m.accessType]}</p>
              <p className="text-muted">{m.rentPrice !== null ? formatPrice(m.rentPrice) : 'Үндсэн үнэ'}</p>
            </Td>
            <Td>{m.fbCode ? <code className="rounded-md bg-accent/12 px-2 py-0.5 text-xs font-bold text-accent">{m.fbCode}</code> : <span className="text-subtle">—</span>}</Td>
            <Td className="tabular-nums">{m.viewCount.toLocaleString()}</Td>
            <Td>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Устгах"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`"${m.title}" киног устгах уу? Энэ үйлдлийг буцаах боломжгүй.`)) del.mutate(m.id);
                }}
              >
                <Trash2 className="size-4 text-red-500" />
              </Button>
            </Td>
          </tr>
        ))}
      </Table>
      {data && <Pager page={page} pages={data.pages} total={data.total} onChange={setPage} />}
      <p className="text-xs text-subtle">
        Зөвлөмж: кино бүрт Facebook код (жишээ нь <code>1</code>) тохируулбал постын comment-д тэр кодыг бичсэн хүнд Messenger-ээр мэдээлэл автоматаар илгээнэ.{' '}
        <Link to="/admin/facebook" className="text-accent hover:underline">
          Facebook bot →
        </Link>
      </p>
    </AdminPage>
  );
}
