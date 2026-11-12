import { useState } from 'react';
import { Link } from 'react-router';
import { MessageCircle, Settings2 } from 'lucide-react';
import { Badge, ButtonLink, Input, Select } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { AdminPage, Card, CopyField, Pager, Table, Td, adminApi, useAdminMutation, useAdminQuery } from './common';

interface Overview {
  enabled: boolean;
  pageId: string;
  templateStyle: string;
  webhookUrl: string;
  codes: { id: string; title: string; slug: string; fbCode: string; status: string; videoStatus: string }[];
  stats7d: Record<string, number>;
}
interface Event {
  id: string;
  kind: 'COMMENT' | 'MESSAGE';
  senderName: string | null;
  senderId: string;
  text: string | null;
  code: string | null;
  status: 'RECEIVED' | 'SENT' | 'NO_MATCH' | 'SKIPPED' | 'FAILED';
  error: string | null;
  createdAt: string;
}

const tone = { SENT: 'success', NO_MATCH: 'neutral', SKIPPED: 'neutral', FAILED: 'danger', RECEIVED: 'warning' } as const;

export default function FacebookBot() {
  const { data } = useAdminQuery<Overview>(['fb', 'overview'], '/facebook/overview');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data: events, isLoading } = useAdminQuery<{ items: Event[]; total: number; pages: number }>(['fb', 'events'], '/facebook/events', { status, page }, { refetchInterval: 15_000 });
  const setCode = useAdminMutation(({ id, fbCode }: { id: string; fbCode: string | null }) => adminApi(`/facebook/codes/${id}`, { method: 'PUT', body: { fbCode } }), {
    success: 'Код шинэчлэгдлээ',
    invalidate: [['fb'], ['movies']],
  });

  return (
    <AdminPage
      title="Facebook Messenger bot"
      subtitle='Пост дээр "1 гэж comment бичээрэй" → хэрэглэгч 1 гэж бичихэд Messenger-ээр киноны мэдээлэл, үнэ, товч автоматаар очно'
      actions={
        <ButtonLink to="/admin/settings?group=facebook" variant="outline">
          <Settings2 className="size-4" /> Тохиргоо
        </ButtonLink>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card title="Төлөв">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className={`grid size-10 place-items-center rounded-xl ${data?.enabled ? 'bg-emerald-500/15 text-emerald-500' : 'bg-elevated text-muted'}`}>
                <MessageCircle className="size-5" />
              </span>
              <div>
                <p className="font-semibold">{data?.enabled ? 'Идэвхтэй' : 'Идэвхгүй'}</p>
                <p className="text-xs text-muted">Page ID: {data?.pageId || '—'} · Загвар: {data?.templateStyle}</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {(['SENT', 'NO_MATCH', 'FAILED', 'SKIPPED'] as const).map((k) => (
                <div key={k} className="rounded-xl bg-elevated/60 p-2">
                  <p className="text-lg font-semibold tabular-nums">{data?.stats7d[k] ?? 0}</p>
                  <p className="text-[10px] text-muted">{k}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-subtle">Сүүлийн 7 хоног</p>
          </div>
        </Card>

        <Card title="Тохируулах заавар">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
            <li>
              Meta for Developers дээр App үүсгэж <b>Messenger</b> бүтээгдэхүүн нэмнэ, Page-ээ холбоно.
            </li>
            <li>
              <Link to="/admin/settings?group=facebook" className="text-accent hover:underline">
                API тохиргоо
              </Link>{' '}
              хэсэгт Page ID, App Secret, Page Access Token, Verify Token оруулна.
            </li>
            <li>Webhook URL болон Verify Token-ийг Meta App → Webhooks хэсэгт оруулна:</li>
          </ol>
          {data && <CopyField value={data.webhookUrl} label="Callback URL" />}
          <ol start={4} className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
            <li>
              Page subscription-д <code>feed</code> болон <code>messages</code> field-үүдийг сонгоно. Шаардлагатай эрх: <code>pages_messaging</code>, <code>pages_read_engagement</code>, <code>pages_manage_engagement</code>.
            </li>
            <li>Кино бүрт доорх хүснэгтээс код оноож, пост дээрээ тэр кодыг бичүүлнэ.</li>
          </ol>
        </Card>
      </div>

      <Card title={`Киноны кодууд (${data?.codes.length ?? 0})`} actions={<Link to="/admin/movies" className="text-xs text-accent hover:underline">Кинонд код нэмэх →</Link>}>
        {data?.codes.length ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.codes.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
                <Input
                  defaultValue={m.fbCode}
                  className="h-9 w-20 text-center font-mono font-bold"
                  onBlur={(e) => {
                    const v = e.target.value.trim().toUpperCase();
                    if (v !== m.fbCode) setCode.mutate({ id: m.id, fbCode: v || null });
                  }}
                />
                <div className="min-w-0 flex-1">
                  <Link to={`/admin/movies/${m.id}`} className="block truncate text-sm font-medium hover:text-accent">
                    {m.title}
                  </Link>
                  <p className="text-xs text-muted">
                    {m.status} · {m.videoStatus}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Код оноосон кино алга. Кино засах хуудсанд "Facebook Messenger код" талбарыг бөглөнө үү.</p>
        )}
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Event log</h2>
        <Select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className="h-9 w-40">
          <option value="">Бүгд</option>
          {Object.keys(tone).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </Select>
      </div>
      <Table head={['Огноо', 'Төрөл', 'Хэрэглэгч', 'Текст', 'Код', 'Төлөв']} empty={!isLoading && !events?.items.length}>
        {events?.items.map((e) => (
          <tr key={e.id}>
            <Td className="text-xs whitespace-nowrap text-muted">{formatDate(e.createdAt, true)}</Td>
            <Td>
              <Badge tone={e.kind === 'COMMENT' ? 'accent' : 'neutral'}>{e.kind === 'COMMENT' ? 'Comment' : 'Messenger'}</Badge>
            </Td>
            <Td className="text-sm">{e.senderName ?? e.senderId}</Td>
            <Td className="max-w-xs truncate text-sm">{e.text}</Td>
            <Td className="font-mono text-xs">{e.code ?? '—'}</Td>
            <Td>
              <Badge tone={tone[e.status]}>{e.status}</Badge>
              {e.error && <p className="mt-1 max-w-xs truncate text-[11px] text-red-500" title={e.error}>{e.error}</p>}
            </Td>
          </tr>
        ))}
      </Table>
      {events && <Pager page={page} pages={events.pages} total={events.total} onChange={setPage} />}
    </AdminPage>
  );
}
