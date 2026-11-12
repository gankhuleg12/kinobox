import { describe, it, expect, vi } from 'vitest';

vi.mock('../../settings/settings.service.js', () => ({ settings: { get: vi.fn(), getMany: vi.fn(), require: vi.fn() } }));

const { computeWireSignature, signatureHeader, verifyWireSignature, wireProvider, mapIntentStatus } = await import('./wire.provider.js');

const secret = 'whsec_test_secret';
const body = Buffer.from(
  JSON.stringify({
    id: 'evt_1',
    object: 'event',
    type: 'payment_intent.succeeded',
    data: { id: 'pi_abc', object: 'payment_intent', status: 'succeeded', amount: 5000, currency: 'MNT', charge: 'ch_1' },
  }),
);
const now = 1_760_000_000;
const headers = (value: string) => ({ 'wirepayment-signature': value });

describe('Wire.mn webhook signature (WirePayment-Signature: t=…,v1=…)', () => {
  it('accepts a valid signature', () => {
    expect(verifyWireSignature(secret, body, headers(signatureHeader(secret, String(now), body)), now)).toBe(true);
  });

  it('accepts when one of several v1 values matches (key rotation)', () => {
    const good = computeWireSignature(secret, String(now), body);
    expect(verifyWireSignature(secret, body, headers(`t=${now},v1=${'0'.repeat(64)},v1=${good}`), now)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const tampered = Buffer.from(body.toString().replace('5000', '1'));
    expect(verifyWireSignature(secret, tampered, headers(signatureHeader(secret, String(now), body)), now)).toBe(false);
  });

  it('rejects wrong secret', () => {
    expect(verifyWireSignature(secret, body, headers(signatureHeader('whsec_other', String(now), body)), now)).toBe(false);
  });

  it('rejects replayed timestamps older than 300s', () => {
    expect(verifyWireSignature(secret, body, headers(signatureHeader(secret, String(now - 301), body)), now)).toBe(false);
  });

  it('rejects malformed or missing header', () => {
    expect(verifyWireSignature(secret, body, {}, now)).toBe(false);
    expect(verifyWireSignature(secret, body, headers('garbage'), now)).toBe(false);
    expect(verifyWireSignature(secret, body, headers(`t=${now}`), now)).toBe(false);
  });
});

describe('Wire.mn payloads', () => {
  it('parses payment_intent.succeeded event', () => {
    expect(wireProvider.parseWebhook(body)).toEqual({
      eventId: 'evt_1',
      invoiceId: 'pi_abc',
      externalId: null,
      status: 'PAID',
      amount: 5000,
      currency: 'MNT',
      transactionId: 'ch_1',
    });
  });

  it('maps canceled and failed events', () => {
    const ev = (type: string, status: string) =>
      wireProvider.parseWebhook(Buffer.from(JSON.stringify({ id: 'evt_2', type, data: { id: 'pi_x', status, amount: 1, currency: 'MNT' } }))).status;
    expect(ev('payment_intent.canceled', 'canceled')).toBe('EXPIRED');
    expect(ev('payment_intent.payment_failed', 'requires_payment_method')).toBe('FAILED');
  });

  it('maps intent statuses', () => {
    expect(mapIntentStatus('succeeded')).toBe('PAID');
    expect(mapIntentStatus('canceled')).toBe('EXPIRED');
    for (const s of ['requires_payment_method', 'requires_action', 'processing', 'new']) expect(mapIntentStatus(s)).toBe('PENDING');
  });
});
