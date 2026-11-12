import { useTranslation } from 'react-i18next';
import { ButtonLink } from '@/components/ui';

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-gradient text-8xl font-black tracking-tighter">404</p>
      <h1 className="mt-4 text-2xl font-bold">{t('notFound.title')}</h1>
      <p className="mt-2 text-muted">{t('notFound.text')}</p>
      <ButtonLink to="/" className="mt-8">
        {t('nav.home')}
      </ButtonLink>
    </div>
  );
}
