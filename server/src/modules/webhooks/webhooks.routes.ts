import express, { Router } from 'express';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { safeEqual } from '../../lib/crypto.js';
import { facebookQueue, safeJobId } from '../../lib/queue.js';
import { rateLimits } from '../../middleware/rateLimit.js';
import { settings } from '../settings/settings.service.js';
import { paymentsService } from '../payments/payments.service.js';
import { extractJobs, verifyFacebookSignature } from '../facebook/bot.service.js';
import { recordDelivery, summarize } from '../facebook/deliveries.js';
import { prisma } from '../../lib/prisma.js';

/**
 * Гадны үйлчилгээний webhook-ууд. Гарын үсэг шалгахын тулд RAW body хэрэгтэй тул
 * энэ router нь express.json()-оос ӨМНӨ холбогдоно.
 */
export const webhooksRouter = Router();
const raw = express.raw({ type: '*/*', limit: '1mb' });

webhooksRouter.use(rateLimits.webhook, (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ── Wire.mn төлбөр
const paymentWebhook = (provider: string) =>
  [
    raw,
    async (req: express.Request, res: express.Response) => {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const result = await paymentsService.handleWebhook(provider, body, req.headers);
      res.json({ received: true, ...result });
    },
  ] as const;

webhooksRouter.post('/wire', ...paymentWebhook('wire'));
if (!env.isProd) webhooksRouter.post('/mock', ...paymentWebhook('mock'));

// ── Facebook: webhook баталгаажуулалт (subscribe хийх үед нэг удаа)
webhooksRouter.get('/facebook', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = await settings.get('facebook.verifyToken');
  if (mode === 'subscribe' && typeof token === 'string' && expected && safeEqual(token, expected) && typeof challenge === 'string') {
    await recordDelivery({ status: 'verify_ok' });
    res.type('text/plain').send(challenge.slice(0, 200));
    return;
  }
  await recordDelivery({ status: 'verify_failed', error: expected ? 'Verify token таарсангүй' : 'Verify token тохируулаагүй' });
  res.sendStatus(403);
});

// ── Facebook: comment + messenger event-үүд
webhooksRouter.post('/facebook', raw, async (req, res) => {
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const cfg = await settings.getMany(['facebook.appSecret', 'facebook.pageId', 'facebook.enabled']);

  if (!cfg['facebook.appSecret']) {
    await recordDelivery({ status: 'no_app_secret' });
    res.sendStatus(401);
    return;
  }
  if (!verifyFacebookSignature(cfg['facebook.appSecret'], body, req.get('x-hub-signature-256'))) {
    logger.warn('Facebook webhook signature invalid — App Secret буруу эсвэл өөр app-ийнх байж магадгүй');
    await recordDelivery({ status: 'signature_invalid', error: 'App Secret нь webhook илгээсэн app-ийнхтай таарахгүй байна' });
    res.sendStatus(401);
    return;
  }
  // Facebook 20 секундэд хариу хүлээдэг тул шууд 200 буцааж, боловсруулалтыг queue-д өгнө
  res.sendStatus(200);

  try {
    const payload = JSON.parse(body.toString('utf8'));
    const { fields, skipped } = summarize(payload, cfg['facebook.pageId']);
    if (!cfg['facebook.enabled']) {
      await recordDelivery({ status: 'bot_disabled', fields });
      return;
    }
    const jobs = extractJobs(payload, cfg['facebook.pageId']);
    logger.info({ fields, jobs: jobs.length, skipped }, 'Facebook webhook received');
    if (!jobs.length) {
      await recordDelivery({ status: 'no_jobs', fields, skipped });
      return;
    }
    // Worker боловсруулахаас өмнө event log-д шууд харагдана (RECEIVED)
    await prisma.fbBotEvent.createMany({
      data: jobs.map((j) => ({
        kind: j.kind,
        externalId: j.externalId,
        postId: j.postId,
        senderId: j.senderId,
        senderName: j.senderName?.slice(0, 191),
        text: j.text.slice(0, 1000),
      })),
      skipDuplicates: true,
    });
    await Promise.all(jobs.map((job) => facebookQueue.add('event', job, { jobId: safeJobId('fb', job.kind, job.externalId) })));
    await recordDelivery({ status: 'enqueued', fields, jobs: jobs.length, skipped });
  } catch (err) {
    logger.error({ err }, 'Facebook webhook enqueue failed');
    await recordDelivery({ status: 'error', error: err instanceof Error ? err.message.slice(0, 200) : 'error' });
  }
});
