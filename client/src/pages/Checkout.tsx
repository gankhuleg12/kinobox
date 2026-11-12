import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Ticket, Crown, Play } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useMovie, usePlans } from '@/lib/queries';
import { Img } from '@/components/movie/Img';
import { Button, ButtonLink, ErrorState, PageSpinner } from '@/components/ui';
import { formatPrice, pick } from '@/lib/format';
import type { PaymentView } from '@/types';
import NotFound from './NotFound';

/**
 * Захиалгын хураангуй → "Төлбөр төлөх" → нэхэмжлэх үүсгээд төлөвийн хуудас руу.
 * Facebook Messenger-ийн товчнууд энд (?src=fb) шууд оруулна.
 */
export default function Checkout({ kind }: { kind: 'rent' | 'plan' }) {
  const { t } = useTranslation();
  const { slug, code } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const source = params.get('src') === 'fb' ? 'facebook' : 'web';
  const movieQ = useMovie(kind === 'rent' ? slug : undefined);
  const plansQ = usePlans();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const plan = kind === 'plan' ? plansQ.data?.find((p) => p.code === code) : undefined;
  const movie = movieQ.data;

  if ((kind === 'rent' && movieQ.isLoading) || (kind === 'plan' && plansQ.isLoading)) return <PageSpinner />;
  if (kind === 'rent' && (movieQ.error || !movie)) return <NotFound />;
  if (kind === 'plan' && !plan) return <NotFound />;

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const item = kind === 'rent' ? { type: 'RENTAL', movieSlug: slug } : { type: 'SUBSCRIPTION', planCode: code };
      const payment = await api<PaymentView>('/payments/checkout', { method: 'POST', body: { item, source } });
      // Wire-ийн hosted хуудас: банк/QR/апп-аа тэнд сонгоод, төлсний дараа манай төлөвийн хуудас руу буцна
      if (payment.paymentUrl && !payment.qrText && !payment.qrImage) {
        navigate(`/checkout/status/${payment.id}`, { replace: true });
        window.location.assign(payment.paymentUrl);
        return;
      }
      navigate(`/checkout/status/${payment.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', String(err)));
      setBusy(false);
    }
  };

  const amount = kind === 'rent' ? movie!.pricing.rentPrice : plan!.price;

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">{t('checkout.title')}</h1>

      <div className="mt-8 overflow-hidden rounded-3xl border border-line bg-surface">
        <div className="flex gap-4 p-5">
          {kind === 'rent' && movie ? (
            <>
              <Img image={movie.poster} alt="" sizes="96px" color={movie.posterColor} className="aspect-2/3 w-20 shrink-0 rounded-xl" />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-accent uppercase">
                  <Ticket className="size-3.5" /> {t('checkout.rental')}
                </p>
                <p className="mt-1 truncate text-lg font-bold">{pick(movie.title, movie.titleEn)}</p>
                <p className="mt-1 text-sm text-muted">
                  {t('checkout.duration')}: {t('checkout.hours', { hours: movie.pricing.rentHours })}
                </p>
              </div>
            </>
          ) : plan ? (
            <>
              <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-gradient-brand text-white">
                <Crown className="size-8" />
              </span>
              <div>
                <p className="text-xs font-semibold tracking-wider text-accent uppercase">{t('checkout.plan')}</p>
                <p className="mt-1 text-lg font-bold">{pick(plan.nameMn, plan.nameEn)}</p>
                <p className="mt-1 text-sm text-muted">
                  {t('checkout.duration')}: {t('checkout.days', { days: plan.durationDays })}
                </p>
              </div>
            </>
          ) : null}
        </div>
        <div className="flex items-center justify-between border-t border-line bg-elevated/50 px-5 py-4">
          <span className="text-muted">{t('checkout.total')}</span>
          <span className="text-2xl font-extrabold">{formatPrice(amount)}</span>
        </div>
      </div>

      {error?.code === 'ALREADY_ENTITLED' ? (
        <div className="mt-6 space-y-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
          <p className="text-sm">{t('checkout.alreadyEntitled')}</p>
          <ButtonLink to={`/watch/${slug}`}>
            <Play className="size-4 fill-current" /> {t('common.watch')}
          </ButtonLink>
        </div>
      ) : (
        <>
          {error && (
            <div className="mt-6">
              <ErrorState error={error} />
            </div>
          )}
          <Button size="lg" className="mt-6 w-full" loading={busy} onClick={() => void pay()}>
            {t('checkout.pay')} · {formatPrice(amount)}
          </Button>
        </>
      )}

      <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted">
        <ShieldCheck className="size-4 text-emerald-500" /> {t('checkout.secure')}
      </p>
    </div>
  );
}
