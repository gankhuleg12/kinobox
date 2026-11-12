import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimits } from '../../middleware/rateLimit.js';
import { validate, input, idParam, slugSchema } from '../../middleware/validate.js';
import { paymentsService, type CheckoutInput } from './payments.service.js';
import { buildMockPaidWebhook } from './providers/mock.provider.js';

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth, (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

const checkoutBody = z.object({
  item: z.discriminatedUnion('type', [
    z.object({ type: z.literal('RENTAL'), movieSlug: slugSchema }),
    z.object({ type: z.literal('SUBSCRIPTION'), planCode: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/i) }),
  ]),
  source: z.enum(['web', 'facebook']).default('web'),
});

paymentsRouter.post('/checkout', rateLimits.checkout, validate({ body: checkoutBody }), async (req, res) => {
  const { body } = input<z.infer<typeof checkoutBody>>(req);
  res.status(201).json(await paymentsService.checkout(req, req.auth!.userId, body.item as CheckoutInput, body.source));
});

paymentsRouter.get('/:id', rateLimits.paymentStatus, validate({ params: idParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  res.json(await paymentsService.getForUser(req.auth!.userId, params.id));
});

/**
 * DEVELOPMENT ONLY: mock провайдероор "төлсөн" webhook-ийг дуурайна.
 * Бодит webhook-тэй яг ижил замаар (гарын үсэг шалгалт орно) явна.
 */
if (!env.isProd) {
  paymentsRouter.post('/:id/dev-simulate-paid', validate({ params: idParam }), async (req, res) => {
    const { params } = input<unknown, unknown, { id: string }>(req);
    const p = await prisma.payment.findFirst({ where: { id: params.id, userId: req.auth!.userId, provider: 'mock' } });
    if (!p?.providerInvoiceId) throw AppError.notFound('Mock төлбөр олдсонгүй');
    const { body, headers } = await buildMockPaidWebhook(p.providerInvoiceId);
    res.json(await paymentsService.handleWebhook('mock', body, headers));
  });
}
