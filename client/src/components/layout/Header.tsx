import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Search, Moon, Sun, Menu, X, User, LogOut, Shield, ChevronDown, Languages } from 'lucide-react';
import { useAuth, isStaff } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { useCategories } from '@/lib/queries';
import { setLanguage } from '@/i18n';
import { buttonClass } from '../ui';
import { cn, pick } from '@/lib/format';
import { Logo } from './Logo';

export function Header() {
  const { t, i18n } = useTranslation();
  const { user, status, logout } = useAuth();
  const toggleTheme = useTheme((s) => s.toggle);
  const { data: categories } = useCategories();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setMenuOpen(false);
    setCatOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const navItem = ({ isActive }: { isActive: boolean }) =>
    cn('rounded-lg px-3 py-2 text-sm font-medium transition-colors', isActive ? 'text-fg' : 'text-muted hover:text-fg');

  const switchLang = () => setLanguage(i18n.language === 'mn' ? 'en' : 'mn');

  return (
    <header className={cn('fixed inset-x-0 top-0 z-50 h-16 transition-all duration-300', scrolled || mobileOpen ? 'glass border-b border-line' : 'bg-linear-to-b from-bg/80 to-transparent')}>
      <div className="flex h-full items-center gap-2 px-4 sm:px-8 lg:px-12">
        <Link to="/" className="mr-4 shrink-0" aria-label="KinoBox">
          <Logo />
        </Link>

        <nav className="hidden items-center md:flex">
          <NavLink to="/" end className={navItem}>
            {t('nav.home')}
          </NavLink>
          <NavLink to="/browse" className={navItem}>
            {t('nav.movies')}
          </NavLink>
          <div className="relative" onMouseEnter={() => setCatOpen(true)} onMouseLeave={() => setCatOpen(false)}>
            <button className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-fg" onClick={() => setCatOpen((v) => !v)} aria-expanded={catOpen}>
              {t('nav.categories')} <ChevronDown className="size-4" />
            </button>
            {catOpen && categories && (
              <div className="absolute top-full left-0 pt-2">
                <div className="grid w-[420px] grid-cols-2 gap-1 rounded-2xl border border-line bg-surface p-2 shadow-2xl animate-fade-in">
                  {categories.map((c) => (
                    <Link key={c.id} to={`/category/${c.slug}`} className="rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-elevated hover:text-fg">
                      {pick(c.nameMn, c.nameEn)}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
          <NavLink to="/reels" className={navItem}>
            {t('nav.reels')}
          </NavLink>
          <NavLink to="/pricing" className={navItem}>
            {t('nav.pricing')}
          </NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => navigate('/search')} className="rounded-xl p-2.5 text-muted transition hover:bg-elevated hover:text-fg" aria-label={t('nav.search')}>
            <Search className="size-5" />
          </button>
          <button onClick={switchLang} className="hidden rounded-xl px-2.5 py-2 text-xs font-bold text-muted uppercase transition hover:bg-elevated hover:text-fg sm:block" aria-label="Language">
            {i18n.language === 'mn' ? 'EN' : 'MN'}
          </button>
          <button onClick={toggleTheme} className="hidden rounded-xl p-2.5 text-muted transition hover:bg-elevated hover:text-fg sm:block" aria-label="Theme">
            <Sun className="hidden size-5 dark:block" />
            <Moon className="size-5 dark:hidden" />
          </button>

          {status === 'authed' && user ? (
            <div className="relative ml-1" ref={menuRef}>
              <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-2 rounded-full p-0.5 ring-2 ring-transparent transition hover:ring-accent/40" aria-label={t('nav.account')}>
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-9 rounded-full object-cover" />
                ) : (
                  <span className="grid size-9 place-items-center rounded-full bg-gradient-brand text-sm font-bold text-white">{user.name.slice(0, 1).toUpperCase()}</span>
                )}
              </button>
              {menuOpen && (
                <div className="absolute top-full right-0 mt-2 w-64 rounded-2xl border border-line bg-surface p-2 shadow-2xl animate-fade-in">
                  <div className="border-b border-line px-3 pt-1 pb-3">
                    <p className="truncate text-sm font-semibold">{user.name}</p>
                    <p className="truncate text-xs text-muted">{user.email}</p>
                  </div>
                  <Link to="/account" className="mt-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-elevated">
                    <User className="size-4" /> {t('nav.account')}
                  </Link>
                  {isStaff(user) && (
                    <Link to="/admin" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-elevated">
                      <Shield className="size-4" /> {t('nav.admin')}
                    </Link>
                  )}
                  <button onClick={switchLang} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-elevated sm:hidden">
                    <Languages className="size-4" /> {i18n.language === 'mn' ? 'English' : 'Монгол'}
                  </button>
                  <button onClick={() => void logout().then(() => navigate('/'))} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-red-500 hover:bg-red-500/10">
                    <LogOut className="size-4" /> {t('nav.logout')}
                  </button>
                </div>
              )}
            </div>
          ) : status === 'guest' ? (
            <Link to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} className={buttonClass('primary', 'sm', 'ml-1 h-9 px-3 sm:px-4')}>
              {t('nav.login')}
            </Link>
          ) : (
            <span className="ml-1 size-9 rounded-full skeleton" />
          )}

          <button onClick={() => setMobileOpen((v) => !v)} className="rounded-xl p-2.5 text-muted hover:bg-elevated md:hidden" aria-label={t('nav.menu')} aria-expanded={mobileOpen}>
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav className="glass max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-line px-4 pb-6 md:hidden animate-fade-in">
          <div className="grid gap-1 pt-2">
            {[
              ['/', t('nav.home')],
              ['/browse', t('nav.movies')],
              ['/reels', t('nav.reels')],
              ['/pricing', t('nav.pricing')],
              ['/search', t('nav.search')],
            ].map(([to, label]) => (
              <NavLink key={to} to={to!} end className={({ isActive }) => cn('rounded-xl px-3 py-3 text-base font-medium', isActive ? 'bg-elevated' : 'text-muted')}>
                {label}
              </NavLink>
            ))}
          </div>
          <div className="mt-3 flex gap-2 px-1">
            <button onClick={toggleTheme} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-sm text-muted">
              <Sun className="hidden size-4 dark:block" />
              <Moon className="size-4 dark:hidden" />
              <span className="dark:hidden">{t('theme.dark')}</span>
              <span className="hidden dark:inline">{t('theme.light')}</span>
            </button>
            <button onClick={switchLang} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-sm text-muted">
              <Languages className="size-4" /> {i18n.language === 'mn' ? 'English' : 'Монгол'}
            </button>
          </div>
          {categories && (
            <>
              <p className="mt-4 mb-2 px-3 text-xs font-semibold tracking-wider text-subtle uppercase">{t('nav.categories')}</p>
              <div className="flex flex-wrap gap-2 px-1">
                {categories.map((c) => (
                  <Link key={c.id} to={`/category/${c.slug}`} className="rounded-full border border-line px-3 py-1.5 text-sm text-muted">
                    {pick(c.nameMn, c.nameEn)}
                  </Link>
                ))}
              </div>
            </>
          )}
        </nav>
      )}
    </header>
  );
}
