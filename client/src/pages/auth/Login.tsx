import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { Button, Field, Input, toast } from '@/components/ui';
import { safeNext } from '@/components/Guards';
import { AuthCard, GoogleButton } from './AuthCard';

export default function Login() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const login = useAuth((s) => s.login);
  const next = safeNext(params.get('next'));
  const oauthError = params.get('error');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(oauthError ? t(`auth.errors.${oauthError}`, { defaultValue: t('auth.errors.google') }) : null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await login(email, password);
      if (res.kickedDevices) toast.info(t('auth.kicked', { count: res.kickedDevices }));
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title={t('auth.loginTitle')}
      subtitle={t('auth.loginSubtitle')}
      footer={
        <>
          {t('auth.noAccount')}{' '}
          <Link to={`/register?next=${encodeURIComponent(next)}`} className="font-semibold text-accent hover:underline">
            {t('nav.register')}
          </Link>
        </>
      }
    >
      <GoogleButton next={next} />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t('auth.email')}>
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} maxLength={191} />
        </Field>
        <Field label={t('auth.password')}>
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} />
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-muted hover:text-accent">
            {t('auth.forgot')}
          </Link>
        </div>
        {error && <p className="rounded-xl bg-red-500/10 px-3 py-2.5 text-sm text-red-500">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!email || !password}>
          {t('auth.loginBtn')}
        </Button>
        <p className="text-center text-xs text-subtle">{t('auth.singleDevice')}</p>
      </form>
    </AuthCard>
  );
}
