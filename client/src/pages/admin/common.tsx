import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { api, type RequestOptions } from '@/lib/api';
import { Badge, Button, toast } from '@/components/ui';
import { cn } from '@/lib/format';

// ── Data hooks
export function useAdminQuery<T>(key: QueryKey, path: string, query?: RequestOptions['query'], opts: { refetchInterval?: number | false; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['admin', ...key, query ?? {}],
    queryFn: ({ signal }) => api<T>(`/admin${path}`, { query, signal }),
    staleTime: 10_000,
    placeholderData: (prev) => prev,
    ...opts,
  });
}

export function useAdminMutation<TVars, TRes = unknown>(fn: (vars: TVars) => Promise<TRes>, opts: { success?: string; invalidate?: QueryKey[] } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      if (opts.success) toast.success(opts.success);
      for (const key of opts.invalidate ?? [[]]) void qc.invalidateQueries({ queryKey: ['admin', ...key] });
    },
    onError: (err) => toast.error(err),
  });
}

export const adminApi = <T,>(path: string, opts?: RequestOptions) => api<T>(`/admin${path}`, opts);

// ── Layout pieces
export function AdminPage({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border border-line bg-surface', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-line bg-elevated/50 text-xs text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-4 py-3 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {empty ? (
            <tr>
              <td colSpan={head.length} className="px-4 py-12 text-center text-muted">
                Мэдээлэл алга
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cn('px-4 py-3 align-middle', className)}>{children}</td>;

export function Pager({ page, pages, total, onChange }: { page: number; pages: number; total?: number; onChange: (p: number) => void }) {
  if (pages <= 1) return total !== undefined ? <p className="text-xs text-muted">Нийт {total}</p> : null;
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-xs text-muted">{total !== undefined && `Нийт ${total.toLocaleString()}`}</p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Өмнөх">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-sm tabular-nums">
          {page} / {pages}
        </span>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Дараах">
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 [&>*]:w-full sm:[&>*]:w-auto">{children}</div>;
}

export function CopyField({ value, label }: { value: string; label?: string }) {
  return (
    <div className="space-y-1">
      {label && <p className="text-xs font-medium text-muted">{label}</p>}
      <div className="flex items-center gap-2 rounded-xl border border-line bg-elevated/60 px-3 py-2">
        <code className="min-w-0 flex-1 truncate text-xs">{value}</code>
        <button
          onClick={() => void navigator.clipboard.writeText(value).then(() => toast.success('Хуулагдлаа'))}
          className="shrink-0 rounded-lg p-1 text-muted hover:bg-surface hover:text-fg"
          aria-label="Хуулах"
        >
          <Copy className="size-4" />
        </button>
      </div>
    </div>
  );
}

// ── Status badges
const payTone = { PAID: 'success', PENDING: 'warning', FAILED: 'danger', EXPIRED: 'neutral', REFUNDED: 'neutral' } as const;
const payLabel = { PAID: 'Төлөгдсөн', PENDING: 'Хүлээгдэж буй', FAILED: 'Амжилтгүй', EXPIRED: 'Хугацаа дууссан', REFUNDED: 'Буцаасан' };
export const PaymentBadge = ({ status }: { status: keyof typeof payTone }) => <Badge tone={payTone[status]}>{payLabel[status]}</Badge>;

const movieTone = { PUBLISHED: 'success', DRAFT: 'neutral', ARCHIVED: 'warning' } as const;
const movieLabel = { PUBLISHED: 'Нийтлэгдсэн', DRAFT: 'Ноорог', ARCHIVED: 'Архив' };
export const MovieStatusBadge = ({ status }: { status: keyof typeof movieTone }) => <Badge tone={movieTone[status]}>{movieLabel[status]}</Badge>;

const videoTone = { NONE: 'neutral', UPLOADING: 'accent', QUEUED: 'warning', PROCESSING: 'accent', READY: 'success', FAILED: 'danger' } as const;
const videoLabel = { NONE: 'Видеогүй', UPLOADING: 'Upload хийж буй', QUEUED: 'Дараалалд', PROCESSING: 'Боловсруулж буй', READY: 'Бэлэн', FAILED: 'Алдаа' };
export const VideoBadge = ({ status, progress }: { status: keyof typeof videoTone; progress?: number }) => (
  <Badge tone={videoTone[status]}>
    {videoLabel[status]}
    {status === 'PROCESSING' && progress !== undefined ? ` ${progress}%` : ''}
  </Badge>
);

export const compactNumber = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : n.toLocaleString('en-US'));

export function useConfirm() {
  return (message: string) => window.confirm(message);
}

export function useToggle(initial = false) {
  const [v, set] = useState(initial);
  return [v, () => set((x) => !x), set] as const;
}
