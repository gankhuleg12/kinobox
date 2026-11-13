import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, Stethoscope, Link2 } from 'lucide-react';
import { Badge, Button, Skeleton } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { Card, adminApi, useAdminMutation, useAdminQuery } from './common';

interface Diagnostics {
  config: { enabled: boolean; pageId: boolean; appId: boolean; appSecret: boolean; pageAccessToken: boolean; verifyToken: boolean; graphVersion: string; webhookUrl: string };
  page: { ok: true; name: string; id: string } | { ok: false; error: string } | null;
  subscription: { ok: boolean; error: string | null; apps: { id: string; name?: string; subscribed_fields?: string[] }[]; subscribed: boolean; feed: boolean; messages: boolean } | null;
  token: { ok: true; type: string | null; isValid: boolean | null; scopes: string[] | null; missing: string[]; expiresAt: number | null } | { ok: false; error: string } | null;
  deliveries: { at: number; status: string; fields?: string[]; jobs?: number; skipped?: string[]; error?: string }[];
  workerOnline: boolean;
}

const deliveryLabel: Record<string, { text: string; tone: 'success' | 'danger' | 'warning' | 'neutral' }> = {
  verify_ok: { text: 'Webhook баталгаажсан', tone: 'success' },
  verify_failed: { text: 'Verify token буруу', tone: 'danger' },
  signature_invalid: { text: 'Гарын үсэг буруу (App Secret)', tone: 'danger' },
  no_app_secret: { text: 'App Secret тохируулаагүй', tone: 'danger' },
  bot_disabled: { text: 'Bot унтраалттай', tone: 'warning' },
  no_jobs: { text: 'Боловсруулах зүйлгүй', tone: 'neutral' },
  enqueued: { text: 'Хүлээн авсан', tone: 'success' },
  error: { text: 'Алдаа', tone: 'danger' },
};

function Check({ ok, warn, title, children }: { ok: boolean; warn?: boolean; title: string; children?: ReactNode }) {
  const Icon = ok ? CheckCircle2 : warn ? AlertTriangle : XCircle;
  return (
    <li className="flex gap-3 py-2.5">
      <Icon className={`mt-0.5 size-5 shrink-0 ${ok ? 'text-emerald-500' : warn ? 'text-amber-500' : 'text-red-500'}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {children && <div className="mt-1 text-xs text-muted">{children}</div>}
      </div>
    </li>
  );
}

/** "Comment бичихэд юу ч болохгүй байна" асуудлыг алхам алхмаар илрүүлнэ */
export function FacebookDiagnostics() {
  const { data: d, isFetching, refetch } = useAdminQuery<Diagnostics>(['fb', 'diagnostics'], '/facebook/diagnostics', undefined, { refetchInterval: 20_000 });
  const subscribe = useAdminMutation(() => adminApi('/facebook/subscribe-page', { method: 'POST' }), {
    success: 'Page app-д subscribe хийгдлээ (feed, messages)',
    invalidate: [['fb']],
  });

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Stethoscope className="size-4 text-accent" /> Оношилгоо
        </span>
      }
      actions={
        <Button size="sm" variant="ghost" icon={<RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />} onClick={() => void refetch()}>
          Шалгах
        </Button>
      }
    >
      {!d ? (
        <Skeleton className="h-60" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <ul className="-my-2 divide-y divide-line">
            <Check ok={d.config.enabled} title="Bot идэвхтэй">
              {!d.config.enabled && (
                <>
                  Унтраалттай үед webhook ирсэн ч хариулахгүй. <Link to="/admin/settings?group=facebook" className="text-accent">Тохиргоо → Messenger bot идэвхтэй</Link>
                </>
              )}
            </Check>
            <Check ok={d.config.pageId && d.config.pageAccessToken && d.config.appSecret && d.config.verifyToken} title="Тохиргоо бүрэн">
              {[!d.config.pageId && 'Page ID', !d.config.pageAccessToken && 'Page Access Token', !d.config.appSecret && 'App Secret', !d.config.verifyToken && 'Verify Token']
                .filter(Boolean)
                .join(', ') || null}
            </Check>
            <Check ok={Boolean(d.page?.ok)} title={d.page?.ok ? `Page token хүчинтэй: ${d.page.name}` : 'Page token'}>
              {d.page && !d.page.ok && d.page.error}
            </Check>
            <Check ok={Boolean(d.subscription?.subscribed && d.subscription.feed && d.subscription.messages)} title="Page app-д subscribe хийгдсэн (feed, messages)">
              {d.subscription && !d.subscription.ok && <p className="mb-2 text-red-500">{d.subscription.error}</p>}
              {d.subscription?.ok && !d.subscription.subscribed && (
                <p className="mb-2">App Dashboard дээр webhook тохируулсан ч page тус бүрийг app-д subscribe хийхгүй бол comment ирэхгүй — хамгийн түгээмэл шалтгаан.</p>
              )}
              {d.subscription?.subscribed && (!d.subscription.feed || !d.subscription.messages) && (
                <p className="mb-2">Дутуу field: {[!d.subscription.feed && 'feed', !d.subscription.messages && 'messages'].filter(Boolean).join(', ')}</p>
              )}
              {d.subscription?.ok && !(d.subscription.subscribed && d.subscription.feed && d.subscription.messages) && (
                <Button size="sm" icon={<Link2 className="size-4" />} loading={subscribe.isPending} onClick={() => subscribe.mutate(undefined)}>
                  Subscribe хийх
                </Button>
              )}
            </Check>
            <Check ok={Boolean(d.token?.ok && d.token.missing.length === 0 && d.token.isValid)} warn={!d.token} title="Токены эрхүүд">
              {!d.token ? (
                <>
                  App ID тохируулбал шалгана. <Link to="/admin/settings?group=facebook" className="text-accent">Тохиргоо</Link>
                </>
              ) : d.token.ok ? (
                <>
                  {d.token.type} · {d.token.isValid ? 'хүчинтэй' : 'хүчингүй'}
                  {d.token.missing.length > 0 && <p className="mt-1 text-red-500">Дутуу эрх: {d.token.missing.join(', ')}</p>}
                </>
              ) : (
                d.token.error
              )}
            </Check>
            <Check ok={d.workerOnline} title="Worker ажиллаж байна">
              {!d.workerOnline && 'Мессеж илгээх ажлыг worker гүйцэтгэдэг (RUN_WORKER=true эсвэл тусдаа worker).'}
            </Check>
          </ul>

          <div className="space-y-3">
            <p className="text-sm font-medium">Сүүлийн webhook хүлээн авалтууд</p>
            {d.deliveries.length === 0 ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
                <p className="font-semibold text-amber-600 dark:text-amber-400">Facebook энэ сервер рүү нэг ч webhook илгээгээгүй байна</p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-muted">
                  <li>Page app-д subscribe хийгдээгүй (зүүн талын "Subscribe хийх")</li>
                  <li>App Dashboard → Webhooks → Page object дээр <b>feed</b>, <b>messages</b> field сонгоогүй</li>
                  <li>
                    App <b>Development</b> горимд бол зөвхөн app-д эрхтэй (admin/developer/tester) хүмүүсийн comment ирнэ — өөрийн хувийн профайлаар comment бичиж туршина. Бусдад ажиллахын тулд app-ыг Live болгож Advanced Access авна
                  </li>
                  <li>Page-ийн нэрээр (Page өөрөө) бичсэн comment-ыг bot зориуд алгасна</li>
                  <li>Render free унтаж байвал Facebook-ийн хүсэлт хугацаа хэтэрч болно — сайтаа нээж сэрээгээд дахин туршина</li>
                </ul>
              </div>
            ) : (
              <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-xl border border-line">
                {d.deliveries.map((x, i) => {
                  const label = deliveryLabel[x.status] ?? { text: x.status, tone: 'neutral' as const };
                  return (
                    <li key={i} className="px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <Badge tone={label.tone}>{label.text}</Badge>
                        <span className="text-muted">{formatDate(new Date(x.at), true)}</span>
                      </div>
                      {x.fields?.length ? <p className="mt-1 font-mono text-[11px] text-muted">{x.fields.join(', ')}</p> : null}
                      {x.skipped?.length ? <p className="mt-0.5 text-amber-600 dark:text-amber-400">Алгассан: {x.skipped.join(', ')}</p> : null}
                      {x.error && <p className="mt-0.5 text-red-500">{x.error}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-[11px] text-subtle">Callback URL: {d.config.webhookUrl} · Graph {d.config.graphVersion}</p>
          </div>
        </div>
      )}
    </Card>
  );
}
