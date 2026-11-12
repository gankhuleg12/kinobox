import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Table2, BarChart3 } from 'lucide-react';
import { Skeleton } from '@/components/ui';
import { formatDate, formatPrice } from '@/lib/format';
import { AdminPage, Card, PaymentBadge, compactNumber, useAdminQuery } from './common';
import { WorkerWarning } from './VideoUploader';

interface Stats {
  users: number;
  newUsers30d: number;
  activeSubscriptions: number;
  pendingPayments: number;
  publishedMovies: number;
  revenueToday: number;
  revenue30d: number;
  paidCount30d: number;
  fbMessages30d: number;
  revenueByDay: { day: string; total: number; count: number }[];
  topMovies: { id: string; title: string; viewCount: number }[];
  recentPayments: { id: string; amount: number; status: 'PAID' | 'PENDING' | 'FAILED' | 'EXPIRED' | 'REFUNDED'; type: string; createdAt: string; user: { email: string } }[];
}

export default function Dashboard() {
  const { data, isLoading } = useAdminQuery<Stats>(['stats'], '/stats');

  if (isLoading || !data) {
    return (
      <AdminPage title="Хянах самбар">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </AdminPage>
    );
  }

  const tiles = [
    { label: 'Өнөөдрийн орлого', value: `${compactNumber(data.revenueToday)}₮` },
    { label: '30 хоногийн орлого', value: `${compactNumber(data.revenue30d)}₮`, sub: `${data.paidCount30d} гүйлгээ` },
    { label: 'Идэвхтэй багц', value: compactNumber(data.activeSubscriptions) },
    { label: 'Хүлээгдэж буй төлбөр', value: compactNumber(data.pendingPayments) },
    { label: 'Нийт хэрэглэгч', value: compactNumber(data.users), sub: `+${data.newUsers30d} сүүлийн 30 хоногт` },
    { label: 'Нийтлэгдсэн кино', value: compactNumber(data.publishedMovies) },
    { label: 'Messenger мессеж (30 хоног)', value: compactNumber(data.fbMessages30d) },
  ];

  return (
    <AdminPage title="Хянах самбар" subtitle="Сүүлийн 30 хоногийн тойм">
      <WorkerWarning />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-xs text-muted">{t.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{t.value}</p>
            {t.sub && <p className="mt-0.5 text-xs text-subtle">{t.sub}</p>}
          </div>
        ))}
      </div>

      <RevenueChart rows={data.revenueByDay} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Сүүлийн төлбөрүүд" actions={<Link to="/admin/payments" className="text-xs text-accent hover:underline">Бүгд →</Link>}>
          <ul className="-my-2 divide-y divide-line">
            {data.recentPayments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{p.user.email}</p>
                  <p className="text-xs text-muted">{formatDate(p.createdAt, true)} · {p.type === 'RENTAL' ? 'Түрээс' : 'Багц'}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <PaymentBadge status={p.status} />
                  <span className="font-medium tabular-nums">{formatPrice(p.amount)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Хамгийн их үзэлттэй">
          <ol className="-my-2 divide-y divide-line">
            {data.topMovies.map((m, i) => (
              <li key={m.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="w-5 text-muted tabular-nums">{i + 1}</span>
                <Link to={`/admin/movies/${m.id}`} className="min-w-0 flex-1 truncate hover:text-accent">
                  {m.title}
                </Link>
                <span className="text-muted tabular-nums">{m.viewCount.toLocaleString()}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </AdminPage>
  );
}

/** Өдөр тутмын орлого: нэг цуваа → legend шаардлагагүй, гарчиг нь цувааг нэрлэнэ */
function RevenueChart({ rows }: { rows: Stats['revenueByDay'] }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [hover, setHover] = useState<number | null>(null);

  const days = useMemo(() => {
    const map = new Map(rows.map((r) => [r.day, r]));
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10);
      return map.get(d) ?? { day: d, total: 0, count: 0 };
    });
  }, [rows]);

  const max = Math.max(...days.map((d) => d.total), 1);
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  const W = 720;
  const H = 240;
  const pad = { l: 44, r: 8, t: 12, b: 24 };
  const band = (W - pad.l - pad.r) / days.length;
  const barW = Math.min(18, band - 2); // ≤24px, хөршүүдийн хооронд ≥2px зай
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const h = hover !== null ? days[hover] : null;

  return (
    <Card
      title="Өдөр тутмын орлого (₮), сүүлийн 30 хоног"
      actions={
        <button onClick={() => setView((v) => (v === 'chart' ? 'table' : 'chart'))} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-fg">
          {view === 'chart' ? <Table2 className="size-3.5" /> : <BarChart3 className="size-3.5" />}
          {view === 'chart' ? 'Хүснэгт' : 'График'}
        </button>
      }
    >
      {view === 'table' ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 text-left font-medium">Огноо</th>
                <th className="py-1 text-right font-medium">Гүйлгээ</th>
                <th className="py-1 text-right font-medium">Орлого</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {days.map((d) => (
                <tr key={d.day}>
                  <td className="py-1.5">{d.day}</td>
                  <td className="py-1.5 text-right tabular-nums">{d.count}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatPrice(d.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Өдөр тутмын орлогын багана график" onMouseLeave={() => setHover(null)}>
            {ticks.map((tv) => (
              <g key={tv}>
                <line x1={pad.l} x2={W - pad.r} y1={y(tv)} y2={y(tv)} stroke="var(--line)" strokeWidth={1} />
                <text x={pad.l - 8} y={y(tv)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)">
                  {compactNumber(tv)}
                </text>
              </g>
            ))}
            {days.map((d, i) => {
              const x = pad.l + i * band + (band - barW) / 2;
              const bh = Math.max(0, y(0) - y(d.total));
              const r = Math.min(4, bh);
              return (
                <g key={d.day}>
                  {/* Дээд талдаа 4px бөөрөнхий, суурь дээрээ дөрвөлжин */}
                  {bh > 0 && (
                    <path
                      d={`M${x},${y(0)} V${y(d.total) + r} Q${x},${y(d.total)} ${x + r},${y(d.total)} H${x + barW - r} Q${x + barW},${y(d.total)} ${x + barW},${y(d.total) + r} V${y(0)} Z`}
                      fill="var(--accent)"
                      opacity={hover === null || hover === i ? 1 : 0.45}
                    />
                  )}
                  {/* Багана өөрөөс нь том hover талбай */}
                  <rect x={pad.l + i * band} y={pad.t} width={band} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />
                  {i % 5 === 0 && (
                    <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--muted)">
                      {d.day.slice(5)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {h && hover !== null && (
            <div
              className="pointer-events-none absolute top-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-xl"
              style={{ left: `clamp(0px, calc(${((pad.l + hover * band + band / 2) / W) * 100}% - 70px), calc(100% - 140px))` }}
            >
              <p className="text-muted">{h.day}</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">{formatPrice(h.total)}</p>
              <p className="text-muted">{h.count} гүйлгээ</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function niceStep(raw: number) {
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
