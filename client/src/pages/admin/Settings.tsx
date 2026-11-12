import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { KeyRound, Lock, PlugZap, Trash2 } from 'lucide-react';
import { Badge, Button, Field, Input, Select, Switch, Textarea, Skeleton, toast } from '@/components/ui';
import { cn } from '@/lib/format';
import { AdminPage, Card, CopyField, adminApi, useAdminMutation, useAdminQuery } from './common';

export interface SettingField {
  key: string;
  type: 'string' | 'int' | 'bool' | 'text' | 'select' | 'url';
  label: string;
  help: string | null;
  options: string[] | null;
  secret: boolean;
  isSet: boolean;
  value: string | number | boolean | null;
  preview: string | null;
}
export interface SettingsResponse {
  groups: { group: string; fields: SettingField[] }[];
  meta: { wireWebhookUrl: string; facebookWebhookUrl: string; googleRedirectUri: string; appUrl: string; isProduction: boolean };
}

const GROUP_LABELS: Record<string, string> = {
  general: 'Ерөнхий',
  pricing: 'Үнэ',
  payment: 'Төлбөр',
  wire: 'Wire.mn',
  r2: 'Cloudflare R2',
  google: 'Google OAuth',
  facebook: 'Facebook',
  smtp: 'SMTP (имэйл)',
};
const TESTABLE = new Set(['wire', 'r2', 'google', 'facebook', 'smtp']);

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const { data, isLoading } = useAdminQuery<SettingsResponse>(['settings'], '/settings');
  const group = params.get('group') ?? 'general';
  const current = data?.groups.find((g) => g.group === group);

  return (
    <AdminPage title="API тохиргоо" subtitle="Бүх түлхүүр AES-256-GCM-ээр шифрлэгдэн хадгалагдана. Secret утга хэзээ ч frontend руу буцаагдахгүй.">
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <nav className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col">
          {(data?.groups ?? []).map((g) => (
            <button
              key={g.group}
              onClick={() => setParams({ group: g.group })}
              className={cn('shrink-0 rounded-xl px-3 py-2 text-left text-sm font-medium transition', g.group === group ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-elevated hover:text-fg')}
            >
              {GROUP_LABELS[g.group] ?? g.group}
            </button>
          ))}
        </nav>
        {isLoading || !data ? <Skeleton className="h-96 rounded-2xl" /> : current ? <GroupForm key={group} group={group} fields={current.fields} meta={data.meta} /> : null}
      </div>
    </AdminPage>
  );
}

function GroupForm({ group, fields, meta }: { group: string; fields: SettingField[]; meta: SettingsResponse['meta'] }) {
  const initial = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f.secret ? '' : (f.value ?? '')])) as Record<string, string | number | boolean>, [fields]);
  const [values, setValues] = useState(initial);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    setValues(initial);
  }, [initial]);

  const dirty = Object.keys(values).filter((k) => {
    const f = fields.find((x) => x.key === k)!;
    return f.secret ? values[k] !== '' : values[k] !== initial[k];
  });

  const save = useAdminMutation(
    (body: { values?: Record<string, unknown>; clear?: string[] }) => adminApi('/settings', { method: 'PUT', body }),
    { success: 'Тохиргоо хадгалагдлаа', invalidate: [['settings']] },
  );

  const submit = () => {
    const out: Record<string, unknown> = {};
    for (const k of dirty) {
      const f = fields.find((x) => x.key === k)!;
      out[k] = f.type === 'int' ? Number(values[k]) : values[k];
    }
    save.mutate({ values: out });
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await adminApi<{ ok: boolean; error?: string; detail?: { name?: string } }>(`/settings/test/${group}`, { method: 'POST' });
      if (r.ok) toast.success(`Холболт амжилттай${r.detail?.name ? `: ${r.detail.name}` : ''}`);
      else toast.error(`Холболт амжилтгүй: ${r.error}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="size-4 text-accent" /> {GROUP_LABELS[group] ?? group}
        </span>
      }
      actions={
        TESTABLE.has(group) && (
          <Button size="sm" variant="outline" loading={testing} icon={<PlugZap className="size-4" />} onClick={() => void test()}>
            Холболт шалгах
          </Button>
        )
      }
    >
      <div className="space-y-5">
        {group === 'wire' && <WireWebhook url={meta.wireWebhookUrl} />}
        {group === 'facebook' && <CopyField label="Facebook webhook callback URL" value={meta.facebookWebhookUrl} />}
        {group === 'google' && <CopyField label="Authorized redirect URI (Google Cloud Console)" value={meta.googleRedirectUri} />}
        {group === 'r2' && (
          <p className="rounded-xl bg-elevated/60 p-3 text-xs text-muted">
            Видео bucket нь private байх ёстой. Зургийн bucket-д public custom domain холбоно. Хоёр bucket-ийн CORS-д <code>{meta.appUrl}</code> origin-ийг GET/PUT-ээр зөвшөөрч, <code>ETag</code> header-ийг expose хийнэ (README-г үзнэ үү).
          </p>
        )}

        {fields.map((f) => (
          <SettingInput
            key={f.key}
            field={f}
            value={values[f.key] ?? ''}
            onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
            onClear={() => window.confirm(`${f.label} утгыг устгах уу?`) && save.mutate({ clear: [f.key] })}
            production={meta.isProduction}
          />
        ))}

        <div className="flex items-center justify-between border-t border-line pt-5">
          <p className="text-xs text-muted">{dirty.length ? `${dirty.length} өөрчлөлт хадгалагдаагүй` : 'Өөрчлөлт алга'}</p>
          <Button onClick={submit} disabled={!dirty.length} loading={save.isPending}>
            Хадгалах
          </Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * Wire.mn дээр webhook URL-ийг API-аар бүртгэж, signing secret-ийг автоматаар хадгална.
 * Webhook заавал биш — тохируулаагүй үед сервер Wire API-аас төлөвийг шалгана.
 */
function WireWebhook({ url }: { url: string }) {
  const register = useAdminMutation(() => adminApi<{ url: string; status: string; replaced: number }>('/settings/wire/register-webhook', { method: 'POST' }), {
    invalidate: [['settings']],
  });
  return (
    <div className="space-y-3 rounded-xl border border-line bg-elevated/40 p-4">
      <CopyField label="Webhook URL" value={url} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          loading={register.isPending}
          onClick={() =>
            register.mutate(undefined, {
              onSuccess: (r) =>
                toast.success(
                  `Webhook бүртгэгдлээ (${r.status}). app.wire.mn дээр endpoint-ийг "Verify" хийнэ үү.${r.replaced ? ` Хуучин ${r.replaced} endpoint солигдсон.` : ''}`,
                ),
            })
          }
        >
          Webhook бүртгэх
        </Button>
        <p className="text-xs text-muted">
          API key хадгалсны дараа дарна. Webhook-гүй үед ч төлбөр серверээс Wire API-аар шалгагдаж баталгаажна (Төлбөр → polling тохиргоо).
        </p>
      </div>
    </div>
  );
}

function SettingInput({
  field: f,
  value,
  onChange,
  onClear,
  production,
}: {
  field: SettingField;
  value: string | number | boolean;
  onChange: (v: string | number | boolean) => void;
  onClear: () => void;
  production: boolean;
}) {
  if (f.type === 'bool') {
    return (
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{f.label}</p>
          {f.help && <p className="text-xs text-muted">{f.help}</p>}
        </div>
        <Switch checked={Boolean(value)} onChange={onChange} />
      </div>
    );
  }

  const label = (
    <span className="flex items-center gap-2">
      {f.label}
      {f.secret && (
        <Badge tone={f.isSet ? 'success' : 'neutral'}>
          <Lock className="size-3" /> {f.isSet ? `Тохируулсан ${f.preview ?? ''}` : 'Тохируулаагүй'}
        </Badge>
      )}
    </span>
  );

  return (
    <Field label={label} hint={f.help ?? (f.secret && f.isSet ? 'Солих бол шинэ утга оруулна. Хоосон үлдээвэл өөрчлөгдөхгүй.' : undefined)}>
      {f.type === 'select' && f.options ? (
        <Select value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {f.options.map((o) => (
            <option key={o} value={o} disabled={production && o === 'mock'}>
              {o}
            </option>
          ))}
        </Select>
      ) : f.type === 'text' ? (
        <Textarea value={String(value)} onChange={(e) => onChange(e.target.value)} rows={5} className="font-mono text-xs" />
      ) : (
        <div className="flex gap-2">
          <Input
            type={f.secret ? 'password' : f.type === 'int' ? 'number' : f.type === 'url' ? 'url' : 'text'}
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            placeholder={f.secret && f.isSet ? '••••••••  (өөрчлөхгүй)' : ''}
            autoComplete="off"
            spellCheck={false}
            className={f.secret ? 'font-mono' : undefined}
          />
          {f.secret && f.isSet && (
            <Button variant="ghost" onClick={onClear} aria-label="Устгах">
              <Trash2 className="size-4 text-red-500" />
            </Button>
          )}
        </div>
      )}
    </Field>
  );
}
