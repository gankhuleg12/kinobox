import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '@/lib/auth';
import { PageSpinner } from '@/components/ui';
import { safeNext } from '@/components/Guards';

/** Google OAuth-ийн дараа: сервер refresh cookie тавьсан тул access token-оо авна */
export default function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const bootstrap = useAuth((s) => s.bootstrap);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void bootstrap().then(() => {
      const ok = useAuth.getState().status === 'authed';
      navigate(ok ? safeNext(params.get('next')) : '/login?error=google', { replace: true });
    });
  }, [bootstrap, navigate, params]);

  return <PageSpinner />;
}
