import { Suspense, useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LogOut } from 'lucide-react';
import { Header } from './Header';
import { Logo } from './Logo';
import { Modal, PageSpinner, ButtonLink } from '../ui';
import { useAuth } from '@/lib/auth';
import { usePublicConfig } from '@/lib/queries';

function Footer() {
  const { t } = useTranslation();
  const { data } = usePublicConfig();
  const email = data?.['general.supportEmail'];
  return (
    <footer className="mt-16 border-t border-line">
      <div className="flex flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
        <div>
          <Logo />
          <p className="mt-2 text-sm text-muted">{t('footer.tagline')}</p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
          <Link to="/browse" className="hover:text-fg">
            {t('nav.movies')}
          </Link>
          <Link to="/pricing" className="hover:text-fg">
            {t('nav.pricing')}
          </Link>
          {email ? (
            <a href={`mailto:${String(email)}`} className="hover:text-fg">
              {String(email)}
            </a>
          ) : null}
        </div>
      </div>
      <p className="border-t border-line px-4 py-5 text-xs text-subtle sm:px-8 lg:px-12">
        © {new Date().getFullYear()} {String(data?.['general.siteName'] ?? 'KinoBox')}. {t('footer.rights')}
      </p>
    </footer>
  );
}

/** Өөр төхөөрөмжөөс нэвтэрсэн үед гарах мэдэгдэл */
export function RevokedNotice() {
  const { t } = useTranslation();
  const { revokedMessage, dismissRevoked } = useAuth();
  return (
    <Modal open={Boolean(revokedMessage)} onClose={dismissRevoked} title={t('auth.revokedTitle')}>
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-amber-500/15 text-amber-500">
          <LogOut className="size-7" />
        </span>
        <p className="text-sm text-muted">{revokedMessage}</p>
        <p className="text-xs text-subtle">{t('auth.singleDevice')}</p>
        <ButtonLink to="/login" onClick={dismissRevoked} className="w-full">
          {t('nav.login')}
        </ButtonLink>
      </div>
    </Modal>
  );
}

export function AppLayout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main className="flex-1 pt-16">
        <Suspense fallback={<PageSpinner />}>
          <Outlet />
        </Suspense>
      </main>
      {/* Reels нь бүтэн дэлгэцийн feed тул footer харуулахгүй */}
      {!pathname.startsWith('/reels') && <Footer />}
    </div>
  );
}
