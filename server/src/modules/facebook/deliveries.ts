import { redis } from '../../lib/redis.js';

/**
 * Facebook webhook хүлээн авалтын оношилгооны бүртгэл (сүүлийн 50, 7 хоног).
 * Event log хоосон үед "Facebook огт илгээгээгүй юу, эсвэл бид хүлээж аваад алгассан уу"
 * гэдгийг ялгахад зориулагдсан. Мессежийн агуулгыг хадгалахгүй — зөвхөн бүтэц.
 */
const KEY = 'fb:deliveries';

export type DeliveryStatus = 'verify_ok' | 'verify_failed' | 'signature_invalid' | 'no_app_secret' | 'bot_disabled' | 'no_jobs' | 'enqueued' | 'error';

export interface Delivery {
  at: number;
  status: DeliveryStatus;
  /** feed:comment:add, messages гэх мэт */
  fields?: string[];
  jobs?: number;
  /** Page өөрөө бичсэн comment зэрэг алгассан шалтгаан */
  skipped?: string[];
  error?: string;
}

export async function recordDelivery(d: Omit<Delivery, 'at'>) {
  await redis
    .multi()
    .lpush(KEY, JSON.stringify({ at: Date.now(), ...d }))
    .ltrim(KEY, 0, 49)
    .expire(KEY, 7 * 86_400)
    .exec()
    .catch(() => undefined);
}

export async function recentDeliveries(limit = 20): Promise<Delivery[]> {
  const rows = await redis.lrange(KEY, 0, limit - 1);
  return rows.flatMap((r) => {
    try {
      return [JSON.parse(r) as Delivery];
    } catch {
      return [];
    }
  });
}

/** Payload-ын бүтцийг (агуулгагүйгээр) товчлох: ямар field, ямар item/verb ирсэн */
export function summarize(body: unknown, pageId: string) {
  const fields = new Set<string>();
  const skipped = new Set<string>();
  const root = body as { object?: string; entry?: { changes?: { field?: string; value?: Record<string, unknown> }[]; messaging?: { message?: { is_echo?: boolean }; sender?: { id?: string } }[] }[] };
  if (root?.object && root.object !== 'page') skipped.add(`object=${root.object}`);
  for (const entry of root?.entry ?? []) {
    for (const c of entry.changes ?? []) {
      const v = c.value ?? {};
      fields.add([c.field, v.item, v.verb].filter(Boolean).join(':'));
      const from = v.from as { id?: string } | undefined;
      if (c.field === 'feed' && v.item === 'comment' && from?.id === pageId) skipped.add('Page өөрөө бичсэн comment');
      if (c.field === 'feed' && v.item === 'comment' && v.verb !== 'add') skipped.add(`comment ${String(v.verb)}`);
    }
    for (const m of entry.messaging ?? []) {
      fields.add(m.message ? 'messages' : 'messaging(other)');
      if (m.message?.is_echo) skipped.add('echo мессеж');
    }
  }
  return { fields: [...fields].slice(0, 10), skipped: [...skipped].slice(0, 5) };
}
