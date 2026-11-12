import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Crown, Laptop, Smartphone, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { setLanguage } from '@/i18n';
import { useTheme, type Theme } from '@/lib/theme';
import { useLibrary, useMyPayments, useMySessions } from '@/lib/queries';
import { Badge, Button, ButtonLink, EmptyState, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { MovieCard } from '@/components/movie/MovieCard';
import { cn, formatDate, formatPrice, pick } from '@/lib/format';
import type { User } from '@/types';

const TABS = ['profile', 'library', 'payments', 'devices'] as const;
type Tab = (typeof TABS)[number];

export default function Account() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('profile');

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <h1 className="text-3xl font-extrabold tracking-tight">{t('account.title')}</h1>
      <div className="no-scrollbar mt-6 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn('-mb-px shrink-0 border-b-2 px-4 py-3 text-sm font-semibold transition', tab === k ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}
          >
            {t(`account.${k}`)}
          </button>
        ))}
      </div>
      <div className="mt-8">
        {tab === 'profile' && <Profile />}
        {tab === 'library' && <LibraryTab />}
        {tab === 'payments' && <PaymentsTab />}
        {tab === 'devices' && <DevicesTab />}
      </div>
    </div>
  );
}

function Profile() {
  const { t, i18n } = useTranslation();
  const { user, setUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState(user?.name ?? '');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [busy, setBusy] = useState<'profile' | 'pw' | null>(null);

  if (!user) return null;

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('profile');
    try {
      const res = await api<{ user: User }>('/auth/me', { method: 'PATCH', body: { name, locale: i18n.language } });
      setUser(res.user);
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('pw');
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: pw.current || undefined, newPassword: pw.next } });
      setPw({ current: '', next: '' });
      setUser({ ...user, hasPassword: true });
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={saveProfile} className="space-y-4 rounded-3xl border border-line bg-surface p-6">
        <Field label={t('auth.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </Field>
        <Field label={t('auth.email')}>
          <Input value={user.email} disabled />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('account.language')}>
            <Select value={i18n.language} onChange={(e) => setLanguage(e.target.value as 'mn' | 'en')}>
              <option value="mn">Монгол</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <Field label="Theme">
            <Select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
              {(['dark', 'light', 'system'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`theme.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button type="submit" loading={busy === 'profile'} disabled={name.trim().length < 2}>
          {t('common.save')}
        </Button>
      </form>

      <form onSubmit={changePassword} className="space-y-4 rounded-3xl border border-line bg-surface p-6">
        <h2 className="font-semibold">{t('account.changePassword')}</h2>
        {user.hasPassword && (
          <Field label={t('account.currentPassword')}>
            <Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} />
          </Field>
        )}
        <Field label={t('account.newPassword')} hint={t('auth.passwordHint')}>
          <Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} />
        </Field>
        <Button type="submit" variant="outline" loading={busy === 'pw'} disabled={pw.next.length < 8}>
          {t('account.changePassword')}
        </Button>
      </form>
    </div>
  );
}

function LibraryTab() {
  const { t } = useTranslation();
  const { data, isLoading } = useLibrary();
  if (isLoading || !data) return <Skeleton className="h-40" />;
  const sub = data.subscription;

  return (
    <div className="space-y-10">
      <div className="relative overflow-hidden rounded-3xl border border-line bg-surface p-6">
        {sub.active && <div className="pointer-events-none absolute -top-20 -right-20 size-60 rounded-full bg-accent/20 blur-3xl" />}
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className={cn('grid size-12 place-items-center rounded-2xl', sub.active ? 'bg-gradient-brand text-white' : 'bg-elevated text-muted')}>
              <Crown className="size-6" />
            </span>
            <div>
              <p className="text-sm text-muted">{t('account.activePlan')}</p>
              <p className="text-lg font-bold">
                {sub.active ? `${pick(sub.planNameMn, sub.planNameEn)} · ${t('account.until', { date: formatDate(sub.endsAt) })}` : t('account.noPlan')}
              </p>
            </div>
          </div>
          <ButtonLink to="/pricing" variant={sub.active ? 'outline' : 'primary'}>
            {t('pricing.choose')}
          </ButtonLink>
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-bold">{t('account.rentals')}</h2>
        {data.rentals.length === 0 ? (
          <EmptyState title={t('account.noRentals')} action={<ButtonLink to="/browse" variant="outline">{t('nav.movies')}</ButtonLink>} />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {data.rentals.map((r) => (
              <div key={r.id}>
                <MovieCard movie={r.movie} />
                <p className="mt-2 text-xs">
                  {r.active ? <Badge tone="success">{t('account.until', { date: formatDate(r.expiresAt, true) })}</Badge> : <Badge>{t('account.expired')}</Badge>}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const statusTone = { PAID: 'success', PENDING: 'warning', FAILED: 'danger', EXPIRED: 'neutral', REFUNDED: 'neutral' } as const;

function PaymentsTab() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useMyPayments(page);
  if (isLoading || !data) return <Skeleton className="h-60" />;
  if (!data.items.length) return <EmptyState title={t('account.noPayments')} />;

  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-surface">
      <ul className="divide-y divide-line">
        {data.items.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="min-w-0">
              <p className="truncate font-medium">{p.movie?.title ?? (p.plan ? pick(p.plan.nameMn, p.plan.nameEn) : '—')}</p>
              <p className="text-xs text-muted">{formatDate(p.createdAt, true)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Badge tone={statusTone[p.status]}>{t(`account.status.${p.status}`)}</Badge>
              <span className="font-semibold tabular-nums">{formatPrice(p.amount)}</span>
            </div>
          </li>
        ))}
      </ul>
      {data.pages > 1 && (
        <div className="flex justify-between border-t border-line px-5 py-3">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ←
          </Button>
          <span className="text-sm text-muted">
            {page} / {data.pages}
          </span>
          <Button size="sm" variant="ghost" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
            →
          </Button>
        </div>
      )}
    </div>
  );
}

function DevicesTab() {
  const { t } = useTranslation();
  const { data, isLoading } = useMySessions();
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-accent/25 bg-accent/5 p-4 text-sm">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" />
        <p className="text-muted">{t('account.devicePolicy')}</p>
      </div>
      {isLoading || !data ? (
        <Skeleton className="h-40" />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface">
          {data.map((s) => {
            const mobile = /iOS|Android/.test(s.deviceName ?? '');
            const Icon = mobile ? Smartphone : Laptop;
            return (
              <li key={s.id} className="flex items-center gap-4 px-5 py-4">
                <Icon className="size-5 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{s.deviceName}</p>
                  <p className="text-xs text-muted">
                    {formatDate(s.createdAt, true)} · {s.ip}
                  </p>
                </div>
                {s.current ? <Badge tone="success">{t('account.current')}</Badge> : s.revokedAt ? <Badge>{t('account.revoked')}</Badge> : <Badge tone="accent">{t('account.active')}</Badge>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
