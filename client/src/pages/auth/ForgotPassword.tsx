import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { MailCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';
import { AuthCard } from './AuthCard';

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title={t('auth.forgotTitle')} subtitle={sent ? undefined : t('auth.forgotText')} footer={<Link to="/login" className="font-semibold text-accent hover:underline">{t('nav.login')}</Link>}>
      {sent ? (
        <div className="flex flex-col items-center gap-4 text-center">
          <MailCheck className="size-12 text-emerald-500" />
          <p className="text-sm text-muted">{t('auth.linkSent')}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label={t('auth.email')}>
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {error && <p className="rounded-xl bg-red-500/10 px-3 py-2.5 text-sm text-red-500">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!email}>
            {t('auth.sendLink')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
