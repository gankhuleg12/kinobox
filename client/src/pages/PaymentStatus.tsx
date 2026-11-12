import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, XCircle, Clock, ExternalLink, Play, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, ButtonLink, ErrorState, PageSpinner, buttonClass } from '@/components/ui';
import { formatClock, formatDate, formatPrice, pick } from '@/lib/format';
import type { PaymentView } from '@/types';

/** Нэхэмжлэх (QR, банкны апп) харуулж, webhook-оор баталгаажих хүртэл төлөвийг шалгана */
export default function PaymentStatus() {
  const { t } = useTranslation();
  const { id } = useParams();
  const qc = useQueryClient();
  const reloadMe = useAuth((s) => s.reloadMe);
  const [now, setNow] = useState(Date.now());
  const [simulating, setSimulating] = useState(false);

  const { data: p, error, refetch } = useQuery({
    queryKey: ['me', 'payment', id],
    queryFn: ({ signal }) => api<PaymentView>(`/payments/${id}`, { signal }),
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? 3000 : false),
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (p?.status === 'PAID') {
      void reloadMe();
      void qc.invalidateQueries({ queryKey: ['me', 'access'] });
      void qc.invalidateQueries({ queryKey: ['me', 'library'] });
    }
  }, [p?.status, reloadMe, qc]);

  if (error) return <div className="mx-auto max-w-lg px-4 py-16"><ErrorState error={error} onRetry={() => void refetch()} /></div>;
  if (!p) return <PageSpinner />;

  const itemName = p.movie ? pick(p.movie.title, null) : p.plan ? pick(p.plan.nameMn, p.plan.nameEn) : '';
  const remaining = Math.max(0, Math.floor((new Date(p.expiresAt).getTime() - now) / 1000));
  const isMock = import.meta.env.DEV && p.qrText?.startsWith('MOCK-PAYMENT');

  if (p.status === 'PAID') {
    return (
      <Result icon={<CheckCircle2 className="size-16 text-emerald-500" />} title={t('checkout.paid')}>
        <p className="text-muted">
          {p.type === 'RENTAL' ? t('checkout.paidRental', { date: formatDate(p.grantUntil, true) }) : t('checkout.paidPlan', { date: formatDate(p.grantUntil) })}
        </p>
        <div className="mt-8 flex justify-center gap-3">
          {p.movie ? (
            <ButtonLink to={`/watch/${p.movie.slug}`} size="lg">
              <Play className="size-5 fill-current" /> {t('common.watch')}
            </ButtonLink>
          ) : (
            <ButtonLink to="/" size="lg">
              {t('checkout.goHome')}
            </ButtonLink>
          )}
        </div>
      </Result>
    );
  }

  if (p.status !== 'PENDING' || remaining === 0) {
    const retry = p.movie ? `/checkout/rent/${p.movie.slug}` : '/pricing';
    return (
      <Result icon={<XCircle className="size-16 text-red-500" />} title={p.status === 'FAILED' ? t('checkout.failed') : t('checkout.expired')}>
        <ButtonLink to={retry} size="lg" className="mt-6">
          {t('checkout.tryAgain')}
        </ButtonLink>
      </Result>
    );
  }

  const simulate = async () => {
    setSimulating(true);
    await api(`/payments/${p.id}/dev-simulate-paid`, { method: 'POST' }).catch(() => undefined);
    await refetch();
    setSimulating(false);
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12 text-center">
      <p className="text-sm font-medium text-muted">{itemName}</p>
      <p className="mt-1 text-4xl font-extrabold tracking-tight">{formatPrice(p.amount)}</p>

      {p.qrText || p.qrImage ? (
        <>
          <div className="mx-auto mt-8 w-fit rounded-3xl border border-line bg-white p-5 shadow-xl shadow-accent/10">
            {p.qrText ? (
              <QRCodeSVG value={p.qrText} size={224} level="M" />
            ) : (
              <img
                src={/^(data:|https:\/\/)/.test(p.qrImage!) ? p.qrImage! : `data:image/png;base64,${p.qrImage}`}
                alt="QR"
                className="size-56"
                referrerPolicy="no-referrer"
              />
            )}
          </div>
          <p className="mt-4 text-sm text-muted">{t('checkout.scanQr')}</p>
        </>
      ) : p.paymentUrl ? (
        // Wire-ийн hosted хуудас: банк, QR, апп-аа тэнд сонгоно
        <div className="mt-8 space-y-3">
          <a href={p.paymentUrl} className={buttonClass('primary', 'lg', 'w-full')}>
            {t('checkout.pay')} <ExternalLink className="size-4" />
          </a>
          <p className="text-sm text-muted">{t('checkout.hostedHint')}</p>
        </div>
      ) : null}

      {p.deeplinks && p.deeplinks.length > 0 && (
        <div className="mt-8">
          <p className="mb-3 text-sm font-semibold">{t('checkout.openBank')}</p>
          <div className="grid grid-cols-4 gap-3">
            {p.deeplinks.map((d) => (
              <a key={d.name} href={d.link} className="flex flex-col items-center gap-1.5 rounded-2xl border border-line p-2 text-[11px] hover:bg-elevated" rel="noopener noreferrer">
                {d.logo ? <img src={d.logo} alt="" className="size-10 rounded-xl" loading="lazy" /> : <span className="size-10 rounded-xl bg-elevated" />}
                <span className="line-clamp-1">{d.name}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {p.paymentUrl && (p.qrText || p.qrImage) && (
        <a href={p.paymentUrl} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline">
          {t('checkout.payOnline')} <ExternalLink className="size-4" />
        </a>
      )}

      <div className="mt-8 flex items-center justify-center gap-3 rounded-2xl bg-elevated px-4 py-3 text-sm">
        <Loader2 className="size-4 animate-spin text-accent" />
        <span>{t('checkout.waiting')}</span>
        <span className="flex items-center gap-1 text-muted tabular-nums">
          <Clock className="size-3.5" /> {formatClock(remaining)}
        </span>
      </div>

      {isMock && (
        <Button variant="outline" className="mt-6" loading={simulating} onClick={() => void simulate()}>
          {t('checkout.devSimulate')}
        </Button>
      )}

      <p className="mt-8 text-xs text-subtle">
        <Link to="/" className="hover:text-fg">
          {t('checkout.goHome')}
        </Link>
      </p>
    </div>
  );
}

function Result({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center animate-fade-in">
      {icon}
      <h1 className="mt-6 text-3xl font-extrabold tracking-tight">{title}</h1>
      <div className="mt-3">{children}</div>
    </div>
  );
}
