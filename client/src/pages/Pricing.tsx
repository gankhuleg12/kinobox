import { useTranslation } from 'react-i18next';
import { Check, Crown, Ticket } from 'lucide-react';
import { usePlans, usePublicConfig } from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import { ButtonLink, Skeleton } from '@/components/ui';
import { cn, formatDate, formatPrice, pick } from '@/lib/format';

export default function Pricing() {
  const { t } = useTranslation();
  const { data: plans, isLoading } = usePlans();
  const subscription = useAuth((s) => s.subscription);
  const features = t('pricing.features', { returnObjects: true }) as string[];
  const { data: config } = usePublicConfig();
  const rentPrice = Number(config?.['pricing.defaultRentPrice'] ?? 0);
  const rentHours = Number(config?.['pricing.defaultRentHours'] ?? 48);

  return (
    <div className="relative overflow-hidden px-4 pt-16 pb-8 sm:px-8 lg:px-12">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[70%] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />

      <div className="relative mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">{t('pricing.title')}</h1>
        <p className="mt-4 text-lg text-muted">{t('pricing.subtitle')}</p>
        {subscription?.active && subscription.endsAt && (
          <p className="mt-6 inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            {t('pricing.activeUntil', { date: formatDate(subscription.endsAt) })}
          </p>
        )}
      </div>

      <div className="relative mx-auto mt-14 flex max-w-5xl flex-wrap justify-center gap-6 [&>*]:w-full md:[&>*]:w-[calc(50%-12px)] lg:[&>*]:w-[calc(33.333%-16px)]">
        {isLoading && Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-[420px] rounded-3xl" />)}

        {plans?.map((p) => {
          const highlight = p.isDefault;
          return (
            <div
              key={p.id}
              className={cn(
                'relative flex flex-col rounded-3xl border p-8 transition hover:-translate-y-1',
                highlight ? 'border-transparent bg-surface shadow-2xl shadow-accent/20 [background:linear-gradient(var(--surface),var(--surface))_padding-box,linear-gradient(135deg,var(--accent),var(--accent-2))_border-box]' : 'border-line bg-surface',
              )}
            >
              {highlight && (
                <span className="absolute -top-3 left-8 rounded-full bg-gradient-brand px-3 py-1 text-xs font-bold text-white shadow-lg">{t('pricing.popular')}</span>
              )}
              <Crown className={cn('size-8', highlight ? 'text-amber-500' : 'text-muted')} />
              <h2 className="mt-4 text-xl font-bold">{pick(p.nameMn, p.nameEn)}</h2>
              {pick(p.descriptionMn, p.descriptionEn) && <p className="mt-1 text-sm text-muted">{pick(p.descriptionMn, p.descriptionEn)}</p>}
              <p className="mt-6 flex items-baseline gap-2">
                <span className="text-4xl font-extrabold tracking-tight">{formatPrice(p.price)}</span>
                <span className="text-muted">/ {t('pricing.perDays', { days: p.durationDays })}</span>
              </p>
              <ul className="mt-6 flex-1 space-y-3 text-sm">
                {features.map((f) => (
                  <li key={f} className="flex items-center gap-3">
                    <span className="grid size-5 place-items-center rounded-full bg-accent/15 text-accent">
                      <Check className="size-3.5" />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <ButtonLink to={`/checkout/plan/${p.code}`} variant={highlight ? 'primary' : 'outline'} size="lg" className="mt-8 w-full">
                {t('pricing.choose')}
              </ButtonLink>
            </div>
          );
        })}

        <div className="flex flex-col rounded-3xl border border-line bg-surface p-8">
          <Ticket className="size-8 text-accent-2" />
          <h2 className="mt-4 text-xl font-bold">{t('pricing.rentTitle')}</h2>
          <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{t('pricing.rentText', { hours: rentHours, price: formatPrice(rentPrice) })}</p>
          <ButtonLink to="/browse" variant="outline" size="lg" className="mt-8 w-full">
            {t('pricing.rentCta')}
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
