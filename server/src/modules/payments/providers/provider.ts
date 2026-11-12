import type { IncomingHttpHeaders } from 'node:http';

/**
 * Төлбөрийн үйлчилгээ үзүүлэгчийн нийтлэг interface.
 * Шинэ провайдер (QPay, SocialPay г.м.) нэмэхдээ энэ interface-ийг хэрэгжүүлж,
 * `providers/index.ts`-д бүртгэхэд хангалттай.
 */
export interface CreateInvoiceInput {
  paymentId: string;
  amount: number;
  currency: 'MNT';
  description: string;
  callbackUrl: string;
  returnUrl: string;
  expiresAt: Date;
}

export interface InvoiceResult {
  invoiceId: string;
  paymentUrl: string | null;
  qrText: string | null;
  /** data: URI, base64 эсвэл https URL */
  qrImage: string | null;
  deeplinks: { name: string; logo?: string; link: string }[];
  /** Провайдер өөрийн хугацааг буцаавал түүнийг мөрдөнө */
  expiresAt?: Date | null;
}

export type ProviderPaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';

export interface WebhookPayload {
  eventId: string;
  invoiceId: string;
  /** Манай талын payment.id (external_id) — байвал давхар шалгалтад ашиглана */
  externalId: string | null;
  status: ProviderPaymentStatus;
  amount: number;
  currency: string;
  transactionId: string | null;
}

export interface InvoiceStatus {
  status: ProviderPaymentStatus;
  amount: number;
  transactionId: string | null;
}

export interface PaymentProvider {
  readonly name: string;
  createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult>;
  /** Raw body + header ашиглан гарын үсэг, timestamp шалгана. Буруу бол false. */
  verifyWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): Promise<boolean>;
  parseWebhook(rawBody: Buffer): WebhookPayload;
  /** Server-to-server давхар баталгаажуулалт */
  getInvoice(invoiceId: string): Promise<InvoiceStatus>;
  cancelInvoice?(invoiceId: string): Promise<void>;
  healthCheck?(): Promise<void>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
