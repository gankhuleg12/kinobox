import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { validate, input, idParam, paginate } from '../../middleware/validate.js';
import { audit } from '../audit/audit.service.js';
import { paymentsService } from '../payments/payments.service.js';
import { providerByName } from '../payments/providers/index.js';

export const paymentsAdmin = Router();

const listQuery = z.object({
  status: z.enum(['PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED']).optional(),
  type: z.enum(['RENTAL', 'SUBSCRIPTION']).optional(),
  source: z.enum(['web', 'facebook']).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
paymentsAdmin.get('/', validate({ query: listQuery }), async (req, res) => {
  const { query } = input<unknown, z.infer<typeof listQuery>>(req);
  const where: Prisma.PaymentWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
    ...(query.q
      ? { OR: [{ id: query.q }, { providerInvoiceId: query.q }, { providerTxnId: query.q }, { user: { email: { contains: query.q } } }] }
      : {}),
  };
  const [items, total, sum] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...paginate(query.page, query.limit),
      select: {
        id: true, type: true, amount: true, currency: true, status: true, provider: true, providerInvoiceId: true, source: true,
        createdAt: true, paidAt: true,
        user: { select: { id: true, name: true, email: true } },
        movie: { select: { title: true } },
        plan: { select: { nameMn: true } },
      },
    }),
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ where: { ...where, status: 'PAID' }, _sum: { amount: true } }),
  ]);
  res.json({ items, total, page: query.page, pages: Math.ceil(total / query.limit), paidSum: sum._sum.amount ?? 0 });
});

paymentsAdmin.get('/:id', validate({ params: idParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  const p = await prisma.payment.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      movie: { select: { id: true, title: true, slug: true } },
      plan: { select: { id: true, nameMn: true, code: true } },
      rental: true,
      subscription: true,
    },
  });
  if (!p) throw AppError.notFound();
  const events = await prisma.webhookEvent.findMany({ where: { paymentId: p.id }, orderBy: { createdAt: 'desc' }, take: 20 });
  const { qrImage: _q, ...rest } = p;
  res.json({ ...rest, webhookEvents: events });
});

/**
 * Webhook ирээгүй/алдаатай үед: провайдерын API-аас төлөвийг шалгана.
 * Провайдер PAID гэж баталгаажуулсан, дүн таарсан үед л эрх олгоно.
 */
paymentsAdmin.post('/:id/verify', validate({ params: idParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  const p = await prisma.payment.findUnique({ where: { id: params.id } });
  if (!p?.providerInvoiceId) throw AppError.notFound();
  const result = await paymentsService.reconcile(p.id);
  const remote = result.remote ?? (await providerByName(p.provider).getInvoice(p.providerInvoiceId));
  const fulfilled = result.changed && remote.status === 'PAID';
  audit({ action: 'payment.manual_verify', entityType: 'payment', entityId: p.id, meta: { remoteStatus: remote.status, fulfilled }, req });
  res.json({ remote, fulfilled });
});

paymentsAdmin.post('/:id/refund', validate({ params: idParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  await paymentsService.markRefunded(req, params.id);
  res.json({ ok: true });
});

const webhookQuery = z.object({
  provider: z.string().max(20).optional(),
  status: z.enum(['RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
});
paymentsAdmin.get('/webhooks/events', validate({ query: webhookQuery }), async (req, res) => {
  const { query } = input<unknown, z.infer<typeof webhookQuery>>(req);
  const where = { ...(query.provider ? { provider: query.provider } : {}), ...(query.status ? { status: query.status } : {}) };
  const [items, total] = await Promise.all([
    prisma.webhookEvent.findMany({ where, orderBy: { createdAt: 'desc' }, ...paginate(query.page, 30) }),
    prisma.webhookEvent.count({ where }),
  ]);
  res.json({ items, total, page: query.page, pages: Math.ceil(total / 30) });
});
