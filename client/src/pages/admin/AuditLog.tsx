import { Fragment, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge, Input, Select } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { AdminPage, FilterBar, Pager, Table, Td, useAdminQuery } from './common';

interface Row {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  userAgent: string | null;
  meta: unknown;
  createdAt: string;
  actor: { name: string; email: string } | null;
}

const ENTITY_TYPES = ['user', 'session', 'movie', 'category', 'plan', 'payment', 'subscription', 'settings'];

const toneFor = (action: string) =>
  /failed|reuse|mismatch|locked|delete|refund|ban/.test(action) ? 'danger' : action.startsWith('settings') ? 'warning' : action.startsWith('payment.paid') ? 'success' : 'neutral';

export default function AuditLog() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, isLoading } = useAdminQuery<{ items: Row[]; total: number; pages: number }>(['audit'], '/audit', { action, entityType, page });

  return (
    <AdminPage title="Audit log" subtitle="Нэвтрэлт, төлбөр, тохиргооны өөрчлөлт зэрэг бүх чухал үйлдлийн бүртгэл">
      <FilterBar>
        <Input placeholder="Үйлдэл (жишээ: auth., payment.)" value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} className="sm:w-72" />
        <Select value={entityType} onChange={(e) => (setEntityType(e.target.value), setPage(1))} className="sm:w-44">
          <option value="">Бүх төрөл</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </FilterBar>

      <Table head={['Огноо', 'Үйлдэл', 'Хэн', 'Объект', 'IP', '']} empty={!isLoading && !data?.items.length}>
        {data?.items.map((r) => (
          <Fragment key={r.id}>
            <tr className="cursor-pointer hover:bg-elevated/50" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
              <Td className="text-xs whitespace-nowrap text-muted">{formatDate(r.createdAt, true)}</Td>
              <Td>
                <Badge tone={toneFor(r.action)}>{r.action}</Badge>
              </Td>
              <Td className="text-sm">{r.actor ? r.actor.email : <span className="text-subtle">system</span>}</Td>
              <Td className="font-mono text-xs text-muted">
                {r.entityType}
                {r.entityId ? `:${r.entityId.slice(0, 14)}` : ''}
              </Td>
              <Td className="font-mono text-xs text-muted">{r.ip ?? '—'}</Td>
              <Td>
                <ChevronDown className={`size-4 text-muted transition ${expanded === r.id ? 'rotate-180' : ''}`} />
              </Td>
            </tr>
            {expanded === r.id && (
              <tr className="bg-elevated/40">
                <td colSpan={6} className="px-4 py-3">
                  <pre className="overflow-x-auto text-xs whitespace-pre-wrap text-muted">{JSON.stringify({ meta: r.meta, userAgent: r.userAgent, entityId: r.entityId }, null, 2)}</pre>
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </Table>
      {data && <Pager page={page} pages={data.pages} total={data.total} onChange={setPage} />}
    </AdminPage>
  );
}
