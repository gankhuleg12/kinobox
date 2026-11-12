import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router';
import { LayoutDashboard, Film, Clapperboard, FolderTree, BadgeDollarSign, Users, CreditCard, Crown, MessageCircle, KeyRound, ScrollText, ArrowLeft, Menu, X, Moon, Sun } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { Logo } from '@/components/layout/Logo';
import { PageSpinner } from '@/components/ui';
import { cn } from '@/lib/format';

const Dashboard = lazy(() => import('./Dashboard'));
const Movies = lazy(() => import('./Movies'));
const MovieEditor = lazy(() => import('./MovieEditor'));
const Categories = lazy(() => import('./Categories'));
const ReelsAdmin = lazy(() => import('./ReelsAdmin'));
const Plans = lazy(() => import('./Plans'));
const UsersPage = lazy(() => import('./Users'));
const Payments = lazy(() => import('./Payments'));
const Subscriptions = lazy(() => import('./Subscriptions'));
const FacebookBot = lazy(() => import('./FacebookBot'));
const SettingsPage = lazy(() => import('./Settings'));
const AuditLog = lazy(() => import('./AuditLog'));

const NAV = [
  { to: '/admin', label: 'Хянах самбар', icon: LayoutDashboard, end: true, adminOnly: false },
  { to: '/admin/movies', label: 'Кино', icon: Film, adminOnly: false },
  { to: '/admin/reels', label: 'Reels', icon: Clapperboard, adminOnly: false },
  { to: '/admin/categories', label: 'Ангилал', icon: FolderTree, adminOnly: false },
  { to: '/admin/plans', label: 'Үнэ & багц', icon: BadgeDollarSign, adminOnly: true },
  { to: '/admin/users', label: 'Хэрэглэгч', icon: Users, adminOnly: true },
  { to: '/admin/payments', label: 'Төлбөр', icon: CreditCard, adminOnly: true },
  { to: '/admin/subscriptions', label: 'Subscription', icon: Crown, adminOnly: true },
  { to: '/admin/facebook', label: 'Facebook bot', icon: MessageCircle, adminOnly: true },
  { to: '/admin/settings', label: 'API тохиргоо', icon: KeyRound, adminOnly: true },
  { to: '/admin/audit', label: 'Audit log', icon: ScrollText, adminOnly: true },
];

export default function AdminApp() {
  const user = useAuth((s) => s.user);
  const toggleTheme = useTheme((s) => s.toggle);
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Drop zone-оос гадуур файл тавихад browser файлыг нээж, хадгалаагүй өөрчлөлт алдагдахаас сэргийлнэ
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  const nav = (
    <nav className="space-y-0.5">
      {NAV.filter((n) => isAdmin || !n.adminOnly).map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          className={({ isActive }) =>
            cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition', isActive ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-elevated hover:text-fg')
          }
        >
          <n.icon className="size-4.5" /> {n.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface p-4 lg:flex">
        <Link to="/admin" className="mb-6 flex items-center gap-2 px-2">
          <Logo />
          <span className="rounded-md bg-elevated px-1.5 py-0.5 text-[10px] font-bold text-muted uppercase">Admin</span>
        </Link>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <Link to="/" className="mt-4 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-elevated hover:text-fg">
          <ArrowLeft className="size-4" /> Сайт руу буцах
        </Link>
      </aside>

      <div className="min-w-0">
        <header className="glass sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line px-4 sm:px-6">
          <button className="rounded-lg p-2 hover:bg-elevated lg:hidden" onClick={() => setOpen(true)} aria-label="Цэс">
            <Menu className="size-5" />
          </button>
          <span className="lg:hidden">
            <Logo compact />
          </span>
          <div className="ml-auto flex items-center gap-3">
            <button onClick={toggleTheme} className="rounded-lg p-2 text-muted hover:bg-elevated hover:text-fg" aria-label="Theme">
              <Sun className="hidden size-4.5 dark:block" />
              <Moon className="size-4.5 dark:hidden" />
            </button>
            <div className="text-right">
              <p className="text-sm leading-tight font-medium">{user?.name}</p>
              <p className="text-[11px] text-muted">{user?.role}</p>
            </div>
          </div>
        </header>

        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface p-4 shadow-2xl animate-fade-in">
              <div className="mb-6 flex items-center justify-between">
                <Logo />
                <button onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-elevated" aria-label="Хаах">
                  <X className="size-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">{nav}</div>
              <Link to="/" className="mt-4 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-elevated">
                <ArrowLeft className="size-4" /> Сайт руу буцах
              </Link>
            </aside>
          </div>
        )}

        <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
          <Suspense fallback={<PageSpinner />}>
            <Routes>
              <Route index element={<Dashboard />} />
              <Route path="movies" element={<Movies />} />
              <Route path="movies/new" element={<MovieEditor />} />
              <Route path="movies/:id" element={<MovieEditor />} />
              <Route path="reels" element={<ReelsAdmin />} />
              <Route path="categories" element={<Categories />} />
              {isAdmin && (
                <>
                  <Route path="plans" element={<Plans />} />
                  <Route path="users" element={<UsersPage />} />
                  <Route path="payments" element={<Payments />} />
                  <Route path="subscriptions" element={<Subscriptions />} />
                  <Route path="facebook" element={<FacebookBot />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="audit" element={<AuditLog />} />
                </>
              )}
              <Route path="*" element={<p className="text-muted">Хуудас олдсонгүй</p>} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
