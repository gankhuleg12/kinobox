import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { rateLimits } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { meRouter } from './modules/me/me.routes.js';
import { paymentsRouter } from './modules/payments/payments.routes.js';
import { playbackRouter } from './modules/playback/playback.routes.js';
import { webhooksRouter } from './modules/webhooks/webhooks.routes.js';
import { adminRouter } from './modules/admin/index.js';
import { mountClient } from './static.js';

function trustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return /^\d+$/.test(value) ? Number(value) : value;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy(env.TRUST_PROXY));
  app.set('etag', 'weak');

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/health' || req.url?.includes('/playback/') === true },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url?.split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // API нь HTML буцаадаггүй тул CSP-г хамгийн хатуу байдлаар тохируулна
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: env.isProd ? { maxAge: 63_072_000, includeSubDomains: true, preload: true } : false,
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-KB-Client', 'X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(compression({ filter: (req, res) => !req.path.startsWith('/api/playback/') && compression.filter(req, res) }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/ready', async (_req, res) => {
    try {
      await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]);
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  // Webhook-ууд raw body шаардана → JSON parser-ээс өмнө
  app.use('/api/webhooks', webhooksRouter);

  app.use(express.json({ limit: '100kb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(cookieParser(env.COOKIE_SECRET));
  app.use((req, _res, next) => {
    req.valid = {};
    next();
  });

  app.use('/api', rateLimits.global);
  app.use('/api/auth', authRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/me', meRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/playback', playbackRouter);
  app.use('/api/admin', adminRouter);

  // Нэг домэйн deploy (Render г.м.): API нь build хийсэн сайтыг өөрөө үйлчилнэ
  if (env.CLIENT_DIST_DIR) mountClient(app, env.CLIENT_DIST_DIR);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
