import { useState } from 'react';
import { Search, LogOut, Ban, CheckCircle2, Unlock, Gift } from 'lucide-react';
import { Badge, Button, Field, Input, Modal, Select, Skeleton } from '@/components/ui';
import { formatDate, formatPrice } from '@/lib/format';
import { AdminPage, Card, FilterBar, Pager, PaymentBadge, Table, Td, adminApi, useAdminMutation, useAdminQuery } from './common';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: 'USER' | 'EDITOR' | 'ADMIN';
  status: 'ACTIVE' | 'BANNED';
  google: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  subscriptionEndsAt: string | null;
}

export default function Users() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading } = useAdminQuery<{ items: UserRow[]; total: number; pages: number }>(['users'], '/users', { q, role, status, page });

  return (
    <AdminPage title="Хэрэглэгч" subtitle="Эрх, төлөв, session, багц удирдах">
      <FilterBar>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input placeholder="Нэр эсвэл email…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="pl-9" />
        </div>
        <Select value={role} onChange={(e) => (setRole(e.target.value), setPage(1))} className="sm:w-40">
          <option value="">Бүх эрх</option>
          <option value="USER">USER</option>
          <option value="EDITOR">EDITOR</option>
          <option value="ADMIN">ADMIN</option>
        </Select>
        <Select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className="sm:w-40">
          <option value="">Бүх төлөв</option>
          <option value="ACTIVE">Идэвхтэй</option>
          <option value="BANNED">Хаагдсан</option>
        </Select>
      </FilterBar>

      <Table head={['Хэрэглэгч', 'Эрх', 'Төлөв', 'Багц', 'Бүртгүүлсэн', 'Сүүлд нэвтэрсэн']} empty={!isLoading && !data?.items.length}>
        {data?.items.map((u) => (
          <tr key={u.id} className="cursor-pointer hover:bg-elevated/50" onClick={() => setOpen(u.id)}>
            <Td>
              <p className="font-medium">{u.name}</p>
              <p className="text-xs text-muted">
                {u.email} {u.google && '· Google'}
              </p>
            </Td>
            <Td>
              <Badge tone={u.role === 'ADMIN' ? 'accent' : u.role === 'EDITOR' ? 'warning' : 'neutral'}>{u.role}</Badge>
            </Td>
            <Td>{u.status === 'ACTIVE' ? <Badge tone="success">Идэвхтэй</Badge> : <Badge tone="danger">Хаагдсан</Badge>}</Td>
            <Td className="text-xs">{u.subscriptionEndsAt ? `${formatDate(u.subscriptionEndsAt)} хүртэл` : <span className="text-subtle">—</span>}</Td>
            <Td className="text-xs text-muted">{formatDate(u.createdAt)}</Td>
            <Td className="text-xs text-muted">{formatDate(u.lastLoginAt, true)}</Td>
          </tr>
        ))}
      </Table>
      {data && <Pager page={page} pages={data.pages} total={data.total} onChange={setPage} />}
      <UserDrawer id={open} onClose={() => setOpen(null)} />
    </AdminPage>
  );
}

interface UserDetail {
  id: string;
  name: string;
  email: string;
  role: UserRow['role'];
  status: UserRow['status'];
  google: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  lockedUntil: string | null;
  sessions: { id: string; deviceName: string | null; ip: string | null; createdAt: string; revokedAt: string | null; revokeReason: string | null }[];
  subscriptions: { id: string; status: string; startsAt: string; endsAt: string; note: string | null; plan: { nameMn: string } }[];
  rentals: { id: string; expiresAt: string; movie: { title: string } }[];
  payments: { id: string; type: string; amount: number; status: 'PAID' | 'PENDING' | 'FAILED' | 'EXPIRED' | 'REFUNDED'; createdAt: string; source: string }[];
}

function UserDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: u } = useAdminQuery<UserDetail>(['user', id], `/users/${id}`, undefined, { enabled: Boolean(id) });
  const { data: plans } = useAdminQuery<{ id: number; nameMn: string; durationDays: number }[]>(['plans'], '/plans', undefined, { enabled: Boolean(id) });
  const [grantPlan, setGrantPlan] = useState('');
  const [grantDays, setGrantDays] = useState('');
  const inv = [['users'], ['user', id]];

  const patch = useAdminMutation((body: Record<string, unknown>) => adminApi(`/users/${id}`, { method: 'PATCH', body }), { success: 'Шинэчлэгдлээ', invalidate: inv });
  const revoke = useAdminMutation(() => adminApi(`/users/${id}/revoke-sessions`, { method: 'POST' }), { success: 'Бүх session хүчингүй боллоо', invalidate: inv });
  const grant = useAdminMutation(
    () => adminApi(`/users/${id}/grant-subscription`, { method: 'POST', body: { planId: Number(grantPlan), ...(grantDays ? { days: Number(grantDays) } : {}) } }),
    { success: 'Багц олгогдлоо', invalidate: inv },
  );

  return (
    <Modal open={Boolean(id)} onClose={onClose} title="Хэрэглэгчийн дэлгэрэнгүй" wide>
      {!u ? (
        <Skeleton className="h-60" />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-lg font-semibold">{u.name}</p>
              <p className="text-sm text-muted">{u.email}</p>
              <p className="mt-1 text-xs text-subtle">
                Бүртгүүлсэн {formatDate(u.createdAt)} · Сүүлд {formatDate(u.lastLoginAt, true)} · {u.lastLoginIp ?? '—'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={u.role} onChange={(e) => window.confirm(`Эрхийг ${e.target.value} болгох уу?`) && patch.mutate({ role: e.target.value })} className="h-9 w-32">
                <option value="USER">USER</option>
                <option value="EDITOR">EDITOR</option>
                <option value="ADMIN">ADMIN</option>
              </Select>
              {u.status === 'ACTIVE' ? (
                <Button size="sm" variant="danger" icon={<Ban className="size-4" />} onClick={() => window.confirm('Хэрэглэгчийг хаах уу? Бүх session хүчингүй болно.') && patch.mutate({ status: 'BANNED' })}>
                  Хаах
                </Button>
              ) : (
                <Button size="sm" variant="outline" icon={<CheckCircle2 className="size-4" />} onClick={() => patch.mutate({ status: 'ACTIVE' })}>
                  Нээх
                </Button>
              )}
              {u.lockedUntil && new Date(u.lockedUntil) > new Date() && (
                <Button size="sm" variant="outline" icon={<Unlock className="size-4" />} onClick={() => patch.mutate({ unlock: true })}>
                  Түгжээ тайлах
                </Button>
              )}
              <Button size="sm" variant="outline" icon={<LogOut className="size-4" />} onClick={() => revoke.mutate(undefined)}>
                Бүх төхөөрөмжөөс гаргах
              </Button>
            </div>
          </div>

          <Card title="Багц олгох (төлбөргүй)">
            <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
              <Field label="Багц">
                <Select value={grantPlan} onChange={(e) => setGrantPlan(e.target.value)}>
                  <option value="">Сонгох…</option>
                  {plans?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nameMn} ({p.durationDays} хоног)
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Хоног (заавал биш)">
                <Input type="number" min={1} value={grantDays} onChange={(e) => setGrantDays(e.target.value)} />
              </Field>
              <Button disabled={!grantPlan} loading={grant.isPending} icon={<Gift className="size-4" />} onClick={() => grant.mutate(undefined)}>
                Олгох
              </Button>
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Session (нэг төхөөрөмж)">
              <ul className="-my-2 divide-y divide-line text-sm">
                {u.sessions.map((s) => (
                  <li key={s.id} className="flex justify-between gap-2 py-2">
                    <span>
                      {s.deviceName} <span className="text-xs text-muted">· {s.ip}</span>
                    </span>
                    {s.revokedAt ? <Badge>{s.revokeReason}</Badge> : <Badge tone="success">Идэвхтэй</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Багцууд">
              <ul className="-my-2 divide-y divide-line text-sm">
                {u.subscriptions.map((s) => (
                  <li key={s.id} className="flex justify-between gap-2 py-2">
                    <span>
                      {s.plan.nameMn} <span className="text-xs text-muted">· {s.note}</span>
                    </span>
                    <span className="text-xs text-muted">
                      {formatDate(s.startsAt)} → {formatDate(s.endsAt)}
                    </span>
                  </li>
                ))}
                {!u.subscriptions.length && <li className="py-2 text-muted">—</li>}
              </ul>
            </Card>
            <Card title="Түрээс">
              <ul className="-my-2 divide-y divide-line text-sm">
                {u.rentals.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2 py-2">
                    <span className="truncate">{r.movie.title}</span>
                    <span className="shrink-0 text-xs text-muted">{formatDate(r.expiresAt, true)}</span>
                  </li>
                ))}
                {!u.rentals.length && <li className="py-2 text-muted">—</li>}
              </ul>
            </Card>
            <Card title="Төлбөр">
              <ul className="-my-2 divide-y divide-line text-sm">
                {u.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="text-xs text-muted">
                      {formatDate(p.createdAt, true)} · {p.type === 'RENTAL' ? 'Түрээс' : 'Багц'} · {p.source}
                    </span>
                    <span className="flex items-center gap-2">
                      <PaymentBadge status={p.status} /> {formatPrice(p.amount)}
                    </span>
                  </li>
                ))}
                {!u.payments.length && <li className="py-2 text-muted">—</li>}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </Modal>
  );
}
