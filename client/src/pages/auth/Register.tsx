import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';
import { safeNext } from '@/components/Guards';
import { AuthCard, GoogleButton } from './AuthCard';

export default function Register() {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const register = useAuth((s) => s.register);
  const next = safeNext(params.get('next'));
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const passwordOk = form.password.length >= 8 && /\p{L}/u.test(form.password) && /\d/.test(form.password);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await register(form.name.trim(), form.email.trim(), form.password, i18n.language);
      navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        setErrors(Object.fromEntries((err.details as { path: string; message: string }[]).map((d) => [d.path, d.message])));
      }
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title={t('auth.registerTitle')}
      subtitle={t('auth.registerSubtitle')}
      footer={
        <>
          {t('auth.haveAccount')}{' '}
          <Link to={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-accent hover:underline">
            {t('nav.login')}
          </Link>
        </>
      }
    >
      <GoogleButton next={next} />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t('auth.name')} error={errors.name}>
          <Input autoComplete="name" required value={form.name} onChange={set('name')} maxLength={100} />
        </Field>
        <Field label={t('auth.email')} error={errors.email}>
          <Input type="email" autoComplete="email" required value={form.email} onChange={set('email')} maxLength={191} />
        </Field>
        <Field label={t('auth.password')} error={errors.password} hint={t('auth.passwordHint')}>
          <Input type="password" autoComplete="new-password" required value={form.password} onChange={set('password')} maxLength={128} />
        </Field>
        {error && !Object.keys(errors).length && <p className="rounded-xl bg-red-500/10 px-3 py-2.5 text-sm text-red-500">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={form.name.trim().length < 2 || !form.email || !passwordOk}>
          {t('auth.registerBtn')}
        </Button>
      </form>
    </AuthCard>
  );
}
