import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth, isStaff } from '@/lib/auth';
import { PageSpinner } from './ui';

export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <PageSpinner />;
  if (status === 'guest') return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

export function RequireStaff({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageSpinner />;
  if (status === 'guest') return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (!isStaff(user)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Дотоод зам эсэхийг шалгана (open redirect хамгаалалт) */
export const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/');

export function GuestOnly({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <PageSpinner />;
  if (status === 'authed') return <Navigate to={safeNext(new URLSearchParams(location.search).get('next'))} replace />;
  return <>{children}</>;
}
