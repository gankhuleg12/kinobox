import { useState } from 'react';
import { Search } from 'lucide-react';
import { Badge, Button, Input, Select } from '@/components/ui';
import { formatDate, formatPrice } from '@/lib/format';
import { AdminPage, FilterBar, Pager, Table, Td, adminApi, useAdminMutation, useAdminQuery } from './common';

interface Row {
  id: string;
  status: 'ACTIVE' | 'CANCELED' | 'EXPIRED';
  startsAt: string;
  endsAt: string;
  note: string | null;
  paymentId: string | null;
  user: { id: string; name: string; email: string };
  plan: { nameMn: string; code: string; price: number };
}

export default function Subscriptions() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [activeOnly, setActiveOnly] = useState('true');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useAdminQuery<{ items: Row[]; total: number; pages: number }>(['subscriptions'], '/subscriptions', { q, status, activeOnly, page });
  const patch = useAdminMutation(({ id, ...body }: { id: string; status?: string; endsAt?: string }) => adminApi(`/subscriptions/${id}`, { method: 'PATCH', body }), {
    success: 'Шинэчлэгдлээ',
    invalidate: [['subscriptions']],
  });

  const extend = (s: Row) => {
    const days = window.prompt('Хэдэн хоногоор сунгах вэ?', '7');
    if (!days || !/^\d+$/.test(days)) return;
    const base = Math.max(new Date(s.endsAt).getTime(), Date.now());
    patch.mutate({ id: s.id, status: 'ACTIVE', endsAt: new Date(base + Number(days) * 86_400_000).toISOString() });
  };

  return (
    <AdminPage title="Subscription" subtitle="Сарын багцын эрхүүд">
      <FilterBar>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input placeholder="Нэр эсвэл email…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="pl-9" />
        </div>
        <Select value={activeOnly} onChange={(e) => (setActiveOnly(e.target.value), setPage(1))} className="sm:w-48">
          <option value="true">Одоо идэвхтэй</option>
          <option value="false">Бүгд</option>
        </Select>
        <Select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className="sm:w-40" disabled={activeOnly === 'true'}>
          <option value="">Бүх төлөв</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="EXPIRED">EXPIRED</option>
          <option value="CANCELED">CANCELED</option>
        </Select>
      </FilterBar>

      <Table head={['Хэрэглэгч', 'Багц', 'Эхэлсэн', 'Дуусах', 'Төлөв', 'Эх сурвалж', '']} empty={!isLoading && !data?.items.length}>
        {data?.items.map((s) => (
          <tr key={s.id}>
            <Td>
              <p className="text-sm">{s.user.name}</p>
              <p className="text-xs text-muted">{s.user.email}</p>
            </Td>
            <Td>
              {s.plan.nameMn} <span className="text-xs text-muted">· {formatPrice(s.plan.price)}</span>
            </Td>
            <Td className="text-xs">{formatDate(s.startsAt)}</Td>
            <Td className="text-xs">{formatDate(s.endsAt)}</Td>
            <Td>
              <Badge tone={s.status === 'ACTIVE' ? 'success' : s.status === 'CANCELED' ? 'danger' : 'neutral'}>{s.status}</Badge>
            </Td>
            <Td className="text-xs text-muted">{s.paymentId ? 'Төлбөр' : (s.note ?? 'Admin')}</Td>
            <Td>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => extend(s)}>
                  Сунгах
                </Button>
                {s.status === 'ACTIVE' && (
                  <Button size="sm" variant="ghost" className="text-red-500" onClick={() => window.confirm('Багцыг цуцлах уу? Эрх шууд дуусна.') && patch.mutate({ id: s.id, status: 'CANCELED' })}>
                    Цуцлах
                  </Button>
                )}
              </div>
            </Td>
          </tr>
        ))}
      </Table>
      {data && <Pager page={page} pages={data.pages} total={data.total} onChange={setPage} />}
    </AdminPage>
  );
}
