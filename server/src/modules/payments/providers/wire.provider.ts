import type { IncomingHttpHeaders } from 'node:http';
import { z } from 'zod';
import { hmacSha256, safeEqual } from '../../../lib/crypto.js';
import { settings } from '../../settings/settings.service.js';
import {
  ProviderError,
  type CreateInvoiceInput,
  type InvoiceResult,
  type InvoiceStatus,
  type PaymentProvider,
  type ProviderPaymentStatus,
  type WebhookPayload,
} from './provider.js';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Wire.mn adapter — https://docs.wire.mn
 * ─────────────────────────────────────────────────────────────────────────────
 *  - Auth: `Authorization: Bearer sk_live_…` (Merchant ID байхгүй — түлхүүр project-оо тодорхойлно)
 *  - POST/DELETE бүрт `Idempotency-Key` заавал
 *  - Дүн: бүхэл төгрөг (15000 = 15,000₮)
 *  - PaymentIntent: requires_payment_method → requires_action → processing → succeeded | canceled
 *  - Webhook: `WirePayment-Signature: t=<unix>,v1=<hex>`, HMAC-SHA256(whsec, `${t}.${rawBody}`), 300 сек
 *  - Webhook заавал биш: `GET /v1/payment_intents/{id}`-ээр серверээс шалгаж болно
 * ─────────────────────────────────────────────────────────────────────────────
 */
const SIGNATURE_HEADER = 'wirepayment-signature';
const TOLERANCE_SEC = 300;
const TIMEOUT_MS = 15_000;
export const WIRE_WEBHOOK_EVENTS = ['payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled'] as const;

const deeplinkSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    logo: z.string().optional(),
    link: z.string().optional(),
    url: z.string().optional(),
  })
  .passthrough();

const nextActionSchema = z
  .object({
    type: z.string(),
    qr: z
      .object({ text: z.string().nullish(), image_url: z.string().nullish(), deeplinks: z.array(deeplinkSchema).nullish() })
      .passthrough()
      .nullish(),
    redirect_to_url: z.object({ url: z.string() }).passthrough().nullish(),
  })
  .passthrough();

const paymentIntentSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    amount: z.number(),
    currency: z.string().optional(),
    expires_at: z.number().nullish(),
    next_action: nextActionSchema.nullish(),
  })
  .passthrough();

const checkoutSessionSchema = z.object({ id: z.string(), url: z.string(), status: z.string().optional() }).passthrough();

const eventSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: z
    .object({
      id: z.string(),
      object: z.string().optional(),
      status: z.string().optional(),
      amount: z.number().optional(),
      currency: z.string().optional(),
      charge: z.string().nullish(),
    })
    .passthrough(),
});

export function mapIntentStatus(status: string): ProviderPaymentStatus {
  switch (status) {
    case 'succeeded':
      return 'PAID';
    case 'canceled':
      return 'EXPIRED';
    default:
      return 'PENDING'; // new, requires_payment_method, requires_action, requires_capture, processing
  }
}

function mapEventStatus(type: string, dataStatus: string | undefined): ProviderPaymentStatus {
  switch (type) {
    case 'payment_intent.succeeded':
      return 'PAID';
    case 'payment_intent.payment_failed':
      return 'FAILED';
    case 'payment_intent.canceled':
      return 'EXPIRED';
    default:
      return dataStatus ? mapIntentStatus(dataStatus) : 'PENDING';
  }
}

// ── Webhook гарын үсэг (цэвэр функцууд — unit test хийгдсэн)
export function computeWireSignature(secret: string, timestamp: string, rawBody: Buffer) {
  return hmacSha256(secret, Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]), 'hex');
}

export function signatureHeader(secret: string, timestamp: string, rawBody: Buffer) {
  return `t=${timestamp},v1=${computeWireSignature(secret, timestamp, rawBody)}`;
}

/** `t=…,v1=…[,v1=…]` — түлхүүр солих үед олон v1 ирж болно */
export function verifyWireSignature(secret: string, rawBody: Buffer, headers: IncomingHttpHeaders, nowSec = Math.floor(Date.now() / 1000)) {
  const header = headers[SIGNATURE_HEADER];
  if (typeof header !== 'string' || header.length > 1000) return false;
  let t: string | undefined;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=', 2);
    if (k === 't') t = v;
    else if (k === 'v1' && v) v1.push(v.toLowerCase());
  }
  if (!t || !/^\d{9,11}$/.test(t) || !v1.length) return false;
  if (Math.abs(nowSec - Number(t)) > TOLERANCE_SEC) return false;
  const expected = computeWireSignature(secret, t, rawBody);
  return v1.some((sig) => safeEqual(expected, sig));
}

/** QR-ийн deeplink-үүдийн формат баримт бичигт тодорхойгүй тул уян хатан хөрвүүлнэ */
function toDeeplinks(list: z.infer<typeof deeplinkSchema>[] | null | undefined) {
  return (list ?? []).flatMap((d) => {
    const link = d.link ?? d.url;
    return link && /^[a-z][a-z0-9+.-]*:/i.test(link) ? [{ name: d.name ?? d.description ?? 'Bank', logo: d.logo, link }] : [];
  });
}

// ── HTTP
async function creds() {
  return settings.require(['wire.baseUrl', 'wire.apiKey'], 'Wire.mn');
}

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, schema: z.ZodType<T>, body?: unknown, idempotencyKey?: string): Promise<T> {
  const c = await creds();
  const res = await fetch(`${c['wire.baseUrl']}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${c['wire.apiKey']}`,
      accept: 'application/json',
      ...(method !== 'GET' ? { 'content-type': 'application/json', 'idempotency-key': idempotencyKey ?? crypto.randomUUID() } : {}),
    },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err: Error) => {
    throw new ProviderError(`Wire.mn холбогдож чадсангүй: ${err.message}`);
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* JSON биш */
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ProviderError(`Wire.mn ${res.status}${err?.code ? ` ${err.code}` : ''}: ${err?.message ?? text.slice(0, 200)}`, res.status);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ProviderError('Wire.mn хариуны формат таарахгүй байна');
  return parsed.data;
}

export const wireProvider: PaymentProvider = {
  name: 'wire',

  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult> {
    const intent = await call(
      'POST',
      '/v1/payment_intents',
      paymentIntentSchema,
      { amount: input.amount, currency: input.currency, description: input.description.slice(0, 500), metadata: { payment_id: input.paymentId } },
      `${input.paymentId}:create`,
    );
    const expiresAt = intent.expires_at ? new Date(intent.expires_at * 1000) : null;
    const mode = await settings.get('wire.checkoutMode');

    // Манай хуудсанд QR: intent-ийг confirm хийж next_action авна
    if (mode === 'qr') {
      try {
        const confirmed = await call('POST', `/v1/payment_intents/${encodeURIComponent(intent.id)}/confirm`, paymentIntentSchema, {}, `${input.paymentId}:confirm`);
        const na = confirmed.next_action;
        if (na?.type === 'qr' && na.qr?.text) {
          return { invoiceId: intent.id, paymentUrl: null, qrText: na.qr.text, qrImage: na.qr.image_url ?? null, deeplinks: toDeeplinks(na.qr.deeplinks), expiresAt };
        }
        if (na?.type === 'redirect_to_url' && na.redirect_to_url?.url) {
          return { invoiceId: intent.id, paymentUrl: na.redirect_to_url.url, qrText: null, qrImage: null, deeplinks: [], expiresAt };
        }
      } catch (err) {
        // confirm амжилтгүй бол hosted checkout руу шилжинэ (intent requires_payment_method хэвээр байвал)
        if (!(err instanceof ProviderError)) throw err;
      }
    }

    // Wire-ийн hosted checkout: бүх банк, QR, апп-ыг Wire өөрөө харуулна
    const session = await call(
      'POST',
      '/v1/checkout/sessions',
      checkoutSessionSchema,
      { payment_intent: intent.id, success_url: input.returnUrl, cancel_url: input.returnUrl },
      `${input.paymentId}:session`,
    );
    return { invoiceId: intent.id, paymentUrl: session.url, qrText: null, qrImage: null, deeplinks: [], expiresAt };
  },

  async verifyWebhook(rawBody, headers) {
    const secret = await settings.get('wire.webhookSecret');
    if (!secret) return false;
    return verifyWireSignature(secret, rawBody, headers);
  },

  parseWebhook(rawBody): WebhookPayload {
    const evt = eventSchema.parse(JSON.parse(rawBody.toString('utf8')));
    return {
      eventId: evt.id,
      invoiceId: evt.data.id,
      externalId: null,
      status: mapEventStatus(evt.type, evt.data.status),
      amount: evt.data.amount ?? 0,
      currency: (evt.data.currency ?? 'MNT').toUpperCase(),
      transactionId: evt.data.charge ?? null,
    };
  },

  async getInvoice(invoiceId): Promise<InvoiceStatus> {
    const intent = await call('GET', `/v1/payment_intents/${encodeURIComponent(invoiceId)}`, paymentIntentSchema);
    return { status: mapIntentStatus(intent.status), amount: intent.amount, transactionId: null };
  },

  async cancelInvoice(invoiceId) {
    await call('POST', `/v1/payment_intents/${encodeURIComponent(invoiceId)}/cancel`, z.unknown(), {}, `cancel:${invoiceId}`);
  },

  async healthCheck() {
    await call('GET', '/v1/payment_intents?limit=1', z.unknown());
  },
};

/**
 * Webhook endpoint-ийг Wire.mn дээр бүртгэнэ. Project бүрт нэг л идэвхтэй endpoint байх тул
 * хуучныг устгаад шинээр үүсгэнэ — signing secret зөвхөн үүсгэх үед буцаагддаг.
 */
export async function registerWireWebhook(url: string) {
  const list = await call('GET', '/v1/webhook_endpoints', z.object({ data: z.array(z.object({ id: z.string(), url: z.string().optional() }).passthrough()) }).passthrough());
  for (const ep of list.data) {
    await call('DELETE', `/v1/webhook_endpoints/${encodeURIComponent(ep.id)}`, z.unknown(), undefined, `delete-endpoint:${ep.id}`);
  }
  const created = await call(
    'POST',
    '/v1/webhook_endpoints',
    z.object({ id: z.string(), secret: z.string(), status: z.string().optional() }).passthrough(),
    { url, enabled_events: WIRE_WEBHOOK_EVENTS },
    `endpoint:${Date.now()}`,
  );
  return { id: created.id, secret: created.secret, status: created.status ?? 'pending', replaced: list.data.length };
}
