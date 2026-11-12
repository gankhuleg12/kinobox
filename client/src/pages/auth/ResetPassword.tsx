import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { Button, Field, Input, toast } from '@/components/ui';
import { AuthCard } from './AuthCard';

export default function ResetPassword() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password } });
      toast.success(t('auth.resetDone'));
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <AuthCard title={t('auth.resetTitle')}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('auth.password')} hint={t('auth.passwordHint')}>
          <Input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} />
        </Field>
        {error && <p className="rounded-xl bg-red-500/10 px-3 py-2.5 text-sm text-red-500">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!token || password.length < 8}>
          {t('auth.resetBtn')}
        </Button>
      </form>
    </AuthCard>
  );
}
