import type { Request } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import { Prisma, type Payment } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { settings } from '../settings/settings.service.js';
import { entitlements } from '../access/entitlement.service.js';
import { audit } from '../audit/audit.service.js';
import { activeProvider, providerByName } from './providers/index.js';
import { ProviderError } from './providers/provider.js';

export type CheckoutInput = { type: 'RENTAL'; movieSlug: string } | { type: 'SUBSCRIPTION'; planCode: string };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function toView(p: Payment & { movie?: { title: string; slug: string } | null; plan?: { nameMn: string; nameEn: string } | null }) {
  return {
    id: p.id,
    type: p.type,
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    paymentUrl: p.paymentUrl,
    qrText: p.qrText,
    qrImage: p.qrImage,
    deeplinks: p.deeplinks,
    expiresAt: p.expiresAt,
    paidAt: p.paidAt,
    movie: p.movie ?? null,
    plan: p.plan ?? null,
  };
}

/**
 * Төлбөр баталгаажсаны дараа эрх олгоно. Idempotent:
 * зөвхөн PENDING/EXPIRED → PAID шилжилт амжилттай болсон үед л эрх үүснэ.
 */
async function fulfill(paymentId: string, transactionId: string | null) {
  const defaultRentHours = await settings.get('pricing.defaultRentHours');

  const result = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const { count } = await tx.payment.updateMany({
      where: { id: paymentId, status: { in: ['PENDING', 'EXPIRED'] } },
      data: { status: 'PAID', paidAt: now, providerTxnId: transactionId },
    });
    if (count === 0) return null;

    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { movie: true, plan: true } });
    // Нэг хэрэглэгчийн эрх олголтыг цуваа болгох (subscription сунгалтын race-аас сэргийлнэ)
    await tx.$queryRaw`SELECT id FROM User WHERE id = ${p.userId} FOR UPDATE`;

    if (p.type === 'RENTAL') {
      if (!p.movie) throw new Error('Rental payment without movie');
      const hours = p.movie.rentHours ?? defaultRentHours;
      const rental = await tx.rental.create({
        data: { userId: p.userId, movieId: p.movie.id, paymentId: p.id, startsAt: now, expiresAt: new Date(now.getTime() + hours * HOUR) },
      });
      return { payment: p, grant: { kind: 'rental' as const, expiresAt: rental.expiresAt } };
    }

    if (!p.plan) throw new Error('Subscription payment without plan');
    const last = await tx.subscription.findFirst({
      where: { userId: p.userId, status: 'ACTIVE', endsAt: { gt: now } },
      orderBy: { endsAt: 'desc' },
      select: { endsAt: true },
    });
    const startsAt = last?.endsAt ?? now;
    const sub = await tx.subscription.create({
      data: { userId: p.userId, planId: p.plan.id, paymentId: p.id, startsAt, endsAt: new Date(startsAt.getTime() + p.plan.durationDays * DAY) },
    });
    return { payment: p, grant: { kind: 'subscription' as const, expiresAt: sub.endsAt } };
  });

  if (result) {
    await entitlements.invalidate(result.payment.userId);
    audit({
      actorId: result.payment.userId,
      action: 'payment.paid',
      entityType: 'payment',
      entityId: paymentId,
      meta: { amount: result.payment.amount, type: result.payment.type, grantUntil: result.grant.expiresAt.toISOString() },
    });
    logger.info({ paymentId, type: result.payment.type }, 'Payment fulfilled');
  }
  return result;
}

export const paymentsService = {
  fulfill,

  async checkout(req: Request, userId: string, input: CheckoutInput, source: 'web' | 'facebook') {
    const provider = await activeProvider();
    let amount: number;
    let description: string;
    let movieId: string | null = null;
    let planId: number | null = null;
    const siteName = await settings.get('general.siteName');

    if (input.type === 'RENTAL') {
      const movie = await prisma.movie.findFirst({ where: { slug: input.movieSlug, status: 'PUBLISHED' } });
      if (!movie) throw AppError.notFound('Кино олдсонгүй');
      if (movie.accessType === 'FREE') throw AppError.badRequest('Энэ кино үнэгүй');
      const access = await entitlements.check(userId, 'USER', movie);
      if (access.allowed) throw AppError.conflict('Танд энэ киног үзэх эрх аль хэдийн байна', 'ALREADY_ENTITLED');
      amount = movie.rentPrice ?? (await settings.get('pricing.defaultRentPrice'));
      description = `${siteName}: ${movie.title} түрээс`;
      movieId = movie.id;
    } else {
      const plan = await prisma.plan.findFirst({ where: { code: input.planCode, isActive: true } });
      if (!plan) throw AppError.notFound('Багц олдсонгүй');
      amount = plan.price;
      description = `${siteName}: ${plan.nameMn}`;
      planId = plan.id;
    }
    if (amount <= 0) throw AppError.badRequest('Үнэ тохируулагдаагүй байна');

    // Ижил бараанд хүчинтэй PENDING нэхэмжлэх байвал дахин ашиглана (давхар invoice үүсгэхгүй)
    const reusable = await prisma.payment.findFirst({
      where: {
        userId,
        status: 'PENDING',
        provider: provider.name,
        type: input.type,
        movieId,
        planId,
        amount,
        providerInvoiceId: { not: null },
        expiresAt: { gt: new Date(Date.now() + 2 * 60_000) },
      },
      orderBy: { createdAt: 'desc' },
      include: { movie: { select: { title: true, slug: true } }, plan: { select: { nameMn: true, nameEn: true } } },
    });
    if (reusable) return toView(reusable);

    const ttl = await settings.get('payment.invoiceTtlMinutes');
    const payment = await prisma.payment.create({
      data: {
        userId,
        type: input.type,
        movieId,
        planId,
        amount,
        provider: provider.name,
        source,
        expiresAt: new Date(Date.now() + ttl * 60_000),
      },
    });

    try {
      const invoice = await provider.createInvoice({
        paymentId: payment.id,
        amount,
        currency: 'MNT',
        description,
        callbackUrl: `${env.apiUrl}/api/webhooks/${provider.name}`,
        returnUrl: `${env.appUrl}/checkout/status/${payment.id}`,
        expiresAt: payment.expiresAt,
      });
      const updated = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          providerInvoiceId: invoice.invoiceId,
          paymentUrl: invoice.paymentUrl,
          qrText: invoice.qrText,
          qrImage: invoice.qrImage,
          deeplinks: invoice.deeplinks as Prisma.InputJsonValue,
          ...(invoice.expiresAt && invoice.expiresAt > new Date() ? { expiresAt: invoice.expiresAt } : {}),
        },
        include: { movie: { select: { title: true, slug: true } }, plan: { select: { nameMn: true, nameEn: true } } },
      });
      audit({ actorId: userId, action: 'payment.created', entityType: 'payment', entityId: payment.id, meta: { amount, type: input.type, source }, req });
      return toView(updated);
    } catch (err) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
      logger.error({ err, paymentId: payment.id }, 'Invoice creation failed');
      if (err instanceof AppError) throw err;
      throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'Төлбөрийн системтэй холбогдоход алдаа гарлаа. Дахин оролдоно уу.');
    }
  },

  /**
   * Провайдерын API-аас (server-to-server) төлөвийг шалгаж, баталгаажсан бол эрх олгоно.
   * Webhook ирээгүй үед ч ажиллана. Browser-ийн мэдээлэлд хэзээ ч итгэхгүй.
   */
  async reconcile(paymentId: string) {
    const p = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p?.providerInvoiceId || (p.status !== 'PENDING' && p.status !== 'EXPIRED')) return { changed: false, remote: null };
    const remote = await providerByName(p.provider).getInvoice(p.providerInvoiceId);

    if (remote.status === 'PAID') {
      if (remote.amount !== p.amount) {
        logger.error({ paymentId, remote: remote.amount, expected: p.amount }, '🚨 Provider amount mismatch on reconcile');
        return { changed: false, remote };
      }
      return { changed: Boolean(await fulfill(p.id, remote.transactionId)), remote };
    }
    if (p.status === 'PENDING' && (remote.status === 'EXPIRED' || remote.status === 'FAILED')) {
      const { count } = await prisma.payment.updateMany({ where: { id: p.id, status: 'PENDING' }, data: { status: remote.status } });
      return { changed: count > 0, remote };
    }
    return { changed: false, remote };
  },

  /** Maintenance: сүүлийн 2 цагийн хүлээгдэж буй төлбөрүүдийг провайдераас шалгана */
  async reconcilePending() {
    if (!(await settings.get('payment.pollFallback'))) return 0;
    const pending = await prisma.payment.findMany({
      where: { status: 'PENDING', providerInvoiceId: { not: null }, createdAt: { gt: new Date(Date.now() - 2 * HOUR) } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true },
    });
    let changed = 0;
    for (const { id } of pending) {
      try {
        if ((await this.reconcile(id)).changed) changed++;
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : err, paymentId: id }, 'Reconcile failed');
      }
    }
    return changed;
  },

  async getForUser(userId: string, paymentId: string) {
    // Webhook ирээгүй бол 5 сек тутамд нэг удаа провайдерын API-аас шалгана
    const pendingCheck = await prisma.payment.findFirst({ where: { id: paymentId, userId }, select: { status: true, createdAt: true } });
    if (pendingCheck?.status === 'PENDING' && Date.now() - pendingCheck.createdAt.getTime() > 5_000 && (await settings.get('payment.pollFallback'))) {
      if (await redis.set(`paypoll:${paymentId}`, '1', 'EX', 5, 'NX')) {
        await this.reconcile(paymentId).catch((err) => logger.warn({ err: err instanceof Error ? err.message : err, paymentId }, 'Status poll failed'));
      }
    }

    const p = await prisma.payment.findFirst({
      where: { id: paymentId, userId },
      include: {
        movie: { select: { title: true, slug: true } },
        plan: { select: { nameMn: true, nameEn: true } },
        rental: { select: { expiresAt: true } },
        subscription: { select: { endsAt: true } },
      },
    });
    if (!p) throw AppError.notFound('Төлбөр олдсонгүй');
    return { ...toView(p), grantUntil: p.rental?.expiresAt ?? p.subscription?.endsAt ?? null };
  },

  /**
   * Webhook боловсруулалт:
   *  1) HMAC гарын үсэг + timestamp  2) event_id-аар давхардал шалгах
   *  3) invoice ↔ payment, дүн, валют тулгах  4) Провайдерын API-аар давхар шалгах
   *  5) Transaction дотор idempotent эрх олгох
   */
  async handleWebhook(providerName: string, rawBody: Buffer, headers: IncomingHttpHeaders) {
    const provider = providerByName(providerName);
    if (!(await provider.verifyWebhook(rawBody, headers))) {
      logger.warn({ provider: providerName }, 'Webhook signature invalid');
      throw AppError.unauthorized('Invalid signature');
    }

    let payload;
    try {
      payload = provider.parseWebhook(rawBody);
    } catch {
      // Гарын үсэг зөв → Wire-ээс ирсэн жинхэнэ мессеж (жишээ нь endpoint.verification ping).
      // 2xx буцаахгүй бол endpoint баталгаажихгүй тул хүлээн аваад алгасна.
      logger.info({ provider: providerName }, 'Webhook without payment payload acknowledged');
      return { ignored: true };
    }

    let event;
    try {
      event = await prisma.webhookEvent.create({
        data: { provider: providerName, eventId: payload.eventId, signatureValid: true, payload: JSON.parse(rawBody.toString('utf8')), status: 'RECEIVED' },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      event = await prisma.webhookEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: providerName, eventId: payload.eventId } } });
      if (event.status === 'PROCESSED' || event.status === 'IGNORED') return { duplicate: true };
    }

    const finish = (status: 'PROCESSED' | 'IGNORED' | 'FAILED', error?: string, paymentId?: string) =>
      prisma.webhookEvent.update({ where: { id: event.id }, data: { status, error: error?.slice(0, 500), paymentId, processedAt: new Date() } });

    try {
      const payment = await prisma.payment.findUnique({ where: { providerInvoiceId: payload.invoiceId } });
      if (!payment || payment.provider !== providerName) {
        await finish('IGNORED', 'Unknown invoice');
        return { ignored: true };
      }
      if (payload.externalId && payload.externalId !== payment.id) {
        await finish('FAILED', 'external_id mismatch', payment.id);
        logger.error({ paymentId: payment.id }, 'Webhook external_id mismatch');
        return { ignored: true };
      }

      if (payload.status !== 'PAID') {
        if (payment.status === 'PENDING' && (payload.status === 'FAILED' || payload.status === 'EXPIRED')) {
          await prisma.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: payload.status } });
        }
        await finish('PROCESSED', undefined, payment.id);
        return { ok: true };
      }

      if (payload.amount !== payment.amount || payload.currency !== payment.currency) {
        await finish('FAILED', `Amount mismatch: got ${payload.amount} ${payload.currency}`, payment.id);
        logger.error({ paymentId: payment.id, got: payload.amount, expected: payment.amount }, '🚨 Webhook amount mismatch');
        audit({ action: 'payment.amount_mismatch', entityType: 'payment', entityId: payment.id, meta: { got: payload.amount, expected: payment.amount } });
        return { ignored: true };
      }

      const doubleCheck = providerName === 'mock' || (await settings.get('wire.verifyViaApi'));
      if (doubleCheck) {
        const remote = await provider.getInvoice(payload.invoiceId);
        if (remote.status !== 'PAID' || remote.amount !== payment.amount) {
          await finish('FAILED', `API verification failed: ${remote.status}`, payment.id);
          logger.error({ paymentId: payment.id, remote }, '🚨 Webhook says PAID but provider API disagrees');
          return { ignored: true };
        }
      }

      await fulfill(payment.id, payload.transactionId);
      await finish('PROCESSED', undefined, payment.id);
      return { ok: true };
    } catch (err) {
      await finish('FAILED', err instanceof Error ? err.message : 'error').catch(() => undefined);
      if (err instanceof ProviderError) logger.error({ err }, 'Provider verification error');
      throw err; // 5xx → провайдер дахин илгээнэ
    }
  },

  async expireStale() {
    const { count } = await prisma.payment.updateMany({
      where: { status: 'PENDING', expiresAt: { lt: new Date(Date.now() - 10 * 60_000) } },
      data: { status: 'EXPIRED' },
    });
    return count;
  },

  /** Admin: буцаалт хийсэн гэж тэмдэглээд олгосон эрхийг цуцална */
  async markRefunded(req: Request, paymentId: string) {
    const p = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw AppError.notFound('Төлбөр олдсонгүй');
    if (p.status !== 'PAID') throw AppError.badRequest('Зөвхөн төлөгдсөн төлбөрийг буцаах боломжтой');
    const now = new Date();
    await prisma.$transaction([
      prisma.payment.update({ where: { id: p.id }, data: { status: 'REFUNDED' } }),
      prisma.rental.updateMany({ where: { paymentId: p.id }, data: { expiresAt: now } }),
      prisma.subscription.updateMany({ where: { paymentId: p.id }, data: { status: 'CANCELED', endsAt: now } }),
    ]);
    await entitlements.invalidate(p.userId);
    audit({ action: 'payment.refunded', entityType: 'payment', entityId: p.id, meta: { amount: p.amount }, req });
  },
};
