import { z } from 'zod';
import { env } from '../../../config/env.js';
import { redis } from '../../../lib/redis.js';
import { hmacSha256, randomToken } from '../../../lib/crypto.js';
import { signatureHeader, verifyWireSignature, wireProvider } from './wire.provider.js';
import type { PaymentProvider } from './provider.js';

/**
 * ЗӨВХӨН DEVELOPMENT: Wire.mn-тэй ижил webhook формат, гарын үсгийн схемтэй хуурамч провайдер.
 * Бүх урсгалыг (invoice → webhook/polling → эрх идэвхжих) бодит төлбөргүйгээр туршина.
 * Production орчинд ашиглахыг providers/index.ts хориглоно.
 */
export const MOCK_WEBHOOK_SECRET = hmacSha256(env.JWT_ACCESS_SECRET, 'mock-webhook-secret');
const key = (id: string) => `mockpay:${id}`;

const stored = z.object({ amount: z.number(), status: z.enum(['PENDING', 'PAID', 'FAILED', 'EXPIRED']), externalId: z.string() });

export const mockProvider: PaymentProvider = {
  name: 'mock',

  async createInvoice(input) {
    const invoiceId = `pi_mock_${randomToken(12)}`;
    await redis.set(key(invoiceId), JSON.stringify({ amount: input.amount, status: 'PENDING', externalId: input.paymentId }), 'EX', 86_400);
    return {
      invoiceId,
      paymentUrl: null,
      qrText: `MOCK-PAYMENT:${invoiceId}:${input.amount}`,
      qrImage: null,
      deeplinks: [],
      expiresAt: new Date(Date.now() + 10 * 60_000),
    };
  },

  async verifyWebhook(rawBody, headers) {
    return verifyWireSignature(MOCK_WEBHOOK_SECRET, rawBody, headers);
  },

  parseWebhook: (rawBody) => wireProvider.parseWebhook(rawBody),

  async getInvoice(invoiceId) {
    const raw = await redis.get(key(invoiceId));
    if (!raw) return { status: 'EXPIRED', amount: 0, transactionId: null };
    const inv = stored.parse(JSON.parse(raw));
    return { status: inv.status, amount: inv.amount, transactionId: inv.status === 'PAID' ? `ch_${invoiceId}` : null };
  },
};

/** Dev simulate endpoint-д: invoice-ийг PAID болгож, Wire.mn форматтай гарын үсэгтэй webhook үүсгэнэ */
export async function buildMockPaidWebhook(invoiceId: string) {
  const raw = await redis.get(key(invoiceId));
  if (!raw) throw new Error('Mock invoice not found');
  const inv = stored.parse(JSON.parse(raw));
  await redis.set(key(invoiceId), JSON.stringify({ ...inv, status: 'PAID' }), 'EX', 86_400);
  const body = Buffer.from(
    JSON.stringify({
      id: `evt_${randomToken(10)}`,
      object: 'event',
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: { id: invoiceId, object: 'payment_intent', status: 'succeeded', amount: inv.amount, currency: 'MNT', charge: `ch_${invoiceId}` },
    }),
  );
  const ts = String(Math.floor(Date.now() / 1000));
  return { body, headers: { 'wirepayment-signature': signatureHeader(MOCK_WEBHOOK_SECRET, ts, body) } };
}
