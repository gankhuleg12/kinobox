import { useState } from 'react';
import { Search, ShieldCheck, Undo2 } from 'lucide-react';
import { Badge, Button, Input, Modal, Select, Skeleton } from '@/components/ui';
import { formatDate, formatPrice } from '@/lib/format';
import { AdminPage, Card, FilterBar, Pager, PaymentBadge, Table, Td, adminApi, useAdminMutation, useAdminQuery } from './common';

type Status = 'PAID' | 'PENDING' | 'FAILED' | 'EXPIRED' | 'REFUNDED';
interface Row {
  id: string;
  type: 'RENTAL' | 'SUBSCRIPTION';
  amount: number;
  status: Status;
  provider: string;
  providerInvoiceId: string | null;
  source: string;
  createdAt: string;
  paidAt: string | null;
  user: { id: string; name: string; email: string };
  movie: { title: string } | null;
  plan: { nameMn: string } | null;
}

export default function Payments() {
  const [filters, setFilters] = useState({ q: '', status: '', type: '', source: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading } = useAdminQuery<{ items: Row[]; total: number; pages: number; paidSum: number }>(['payments'], '/payments', { ...filters, page });
  const setF = (k: keyof typeof filters) => (e: { target: { value: string } }) => (setFilters((f) => ({ ...f, [k]: e.target.value })), setPage(1));

  return (
    <AdminPage title="Төлбөр" subtitle="Wire.mn гүйлгээ, webhook баталгаажуулалт">
      <FilterBar>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input placeholder="Email, payment ID, invoice ID…" value={filters.q} onChange={setF('q')} className="pl-9" />
        </div>
        <Select value={filters.status} onChange={setF('status')} className="sm:w-44">
          <option value="">Бүх төлөв</option>
          <option value="PAID">Төлөгдсөн</option>
          <option value="PENDING">Хүлээгдэж буй</option>
          <option value="FAILED">Амжилтгүй</option>
          <option value="EXPIRED">Хугацаа дууссан</option>
          <option value="REFUNDED">Буцаасан</option>
        </Select>
        <Select value={filters.type} onChange={setF('type')} className="sm:w-40">
          <option value="">Бүх төрөл</option>
          <option value="RENTAL">Түрээс</option>
          <option value="SUBSCRIPTION">Багц</option>
        </Select>
        <Select value={filters.source} onChange={setF('source')} className="sm:w-40">
          <option value="">Бүх суваг</option>
          <option value="web">Вэб</option>
          <option value="facebook">Facebook</option>
        </Select>
      </FilterBar>
      {data && <p className="text-sm text-muted">Шүүлтүүрт таарах төлөгдсөн дүн: <span className="font-semibold text-fg">{formatPrice(data.paidSum)}</span></p>}

      <Table head={['Огноо', 'Хэрэглэгч', 'Бараа', 'Дүн', 'Төлөв', 'Суваг', 'Invoice']} empty={!isLoading && !data?.items.length}>
        {data?.items.map((p) => (
          <tr key={p.id} className="cursor-pointer hover:bg-elevated/50" onClick={() => setOpen(p.id)}>
            <Td className="text-xs whitespace-nowrap text-muted">{formatDate(p.createdAt, true)}</Td>
            <Td>
              <p className="text-sm">{p.user.name}</p>
              <p className="text-xs text-muted">{p.user.email}</p>
            </Td>
            <Td className="text-sm">
              <Badge tone={p.type === 'RENTAL' ? 'neutral' : 'accent'}>{p.type === 'RENTAL' ? 'Түрээс' : 'Багц'}</Badge> {p.movie?.title ?? p.plan?.nameMn}
            </Td>
            <Td className="font-semibold tabular-nums">{formatPrice(p.amount)}</Td>
            <Td>
              <PaymentBadge status={p.status} />
            </Td>
            <Td className="text-xs">{p.source}</Td>
            <Td className="font-mono text-[11px] text-muted">{p.providerInvoiceId?.slice(0, 18) ?? '—'}</Td>
          </tr>
        ))}
      </Table>
      {data && <Pager page={page} pages={data.pages} total={data.total} onChange={setPage} />}
      <PaymentDetail id={open} onClose={() => setOpen(null)} />
    </AdminPage>
  );
}

interface Detail extends Omit<Row, 'movie' | 'plan'> {
  currency: string;
  providerTxnId: string | null;
  expiresAt: string;
  movie: { title: string; slug: string } | null;
  plan: { nameMn: string; code: string } | null;
  rental: { expiresAt: string } | null;
  subscription: { endsAt: string; status: string } | null;
  webhookEvents: { id: string; eventId: string; status: string; error: string | null; createdAt: string; signatureValid: boolean }[];
}

function PaymentDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: p } = useAdminQuery<Detail>(['payment', id], `/payments/${id}`, undefined, { enabled: Boolean(id) });
  const inv = [['payments'], ['payment', id]];
  const verify = useAdminMutation(() => adminApi<{ remote: { status: string }; fulfilled: boolean }>(`/payments/${id}/verify`, { method: 'POST' }), { invalidate: inv });
  const refund = useAdminMutation(() => adminApi(`/payments/${id}/refund`, { method: 'POST' }), { success: 'Буцаалт бүртгэгдэж, эрх цуцлагдлаа', invalidate: inv });

  return (
    <Modal open={Boolean(id)} onClose={onClose} title="Төлбөрийн дэлгэрэнгүй" wide>
      {!p ? (
        <Skeleton className="h-60" />
      ) : (
        <div className="space-y-6">
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            {[
              ['Payment ID', <code key="id" className="text-xs">{p.id}</code>],
              ['Төлөв', <PaymentBadge key="s" status={p.status} />],
              ['Дүн', `${formatPrice(p.amount)} ${p.currency}`],
              ['Хэрэглэгч', p.user.email],
              ['Бараа', p.movie?.title ?? p.plan?.nameMn],
              ['Суваг', p.source],
              ['Провайдер', p.provider],
              ['Invoice ID', <code key="inv" className="text-xs break-all">{p.providerInvoiceId ?? '—'}</code>],
              ['Transaction ID', <code key="tx" className="text-xs break-all">{p.providerTxnId ?? '—'}</code>],
              ['Үүссэн', formatDate(p.createdAt, true)],
              ['Төлөгдсөн', formatDate(p.paidAt, true)],
              ['Эрх дуусах', formatDate(p.rental?.expiresAt ?? p.subscription?.endsAt, true)],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="mt-0.5">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap gap-2">
            {(p.status === 'PENDING' || p.status === 'EXPIRED') && (
              <Button
                variant="outline"
                icon={<ShieldCheck className="size-4" />}
                loading={verify.isPending}
                onClick={() =>
                  verify.mutate(undefined, {
                    onSuccess: (r) => alert(r.fulfilled ? 'Провайдер баталгаажуулж, эрх идэвхжлээ.' : `Провайдерын төлөв: ${r.remote.status}`),
                  })
                }
              >
                Провайдерээс шалгах
              </Button>
            )}
            {p.status === 'PAID' && (
              <Button variant="danger" icon={<Undo2 className="size-4" />} loading={refund.isPending} onClick={() => window.confirm('Буцаалт хийсэн гэж тэмдэглэж, олгосон эрхийг цуцлах уу?') && refund.mutate(undefined)}>
                Буцаалт бүртгэх
              </Button>
            )}
          </div>

          <Card title="Webhook event-үүд">
            {p.webhookEvents.length === 0 ? (
              <p className="text-sm text-muted">Webhook ирээгүй байна</p>
            ) : (
              <ul className="-my-2 divide-y divide-line text-sm">
                {p.webhookEvents.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="font-mono text-xs">{e.eventId}</span>
                    <span className="flex items-center gap-2 text-xs">
                      {e.error && <span className="text-red-500">{e.error}</span>}
                      <Badge tone={e.status === 'PROCESSED' ? 'success' : e.status === 'FAILED' ? 'danger' : 'neutral'}>{e.status}</Badge>
                      <span className="text-muted">{formatDate(e.createdAt, true)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </Modal>
  );
}
