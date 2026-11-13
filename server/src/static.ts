import express, { type Express } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './lib/logger.js';

/**
 * Build хийсэн React сайтыг API-тай НЭГ домэйноос үйлчилнэ (nginx-гүй орчинд, жишээ нь Render).
 * Нэг origin тул refresh cookie, CORS асуудалгүй ажиллана.
 *  - /assets/* : hash-тай файлууд, 1 жил immutable cache
 *  - бусад GET : index.html (SPA fallback), cache-гүй, inline script-ийн hash-тай хатуу CSP
 */
export function mountClient(app: Express, dir: string) {
  const root = path.resolve(dir);
  const indexPath = path.join(root, 'index.html');
  if (!fs.existsSync(indexPath)) {
    logger.warn({ root }, 'CLIENT_DIST_DIR-д index.html олдсонгүй — сайт үйлчлэгдэхгүй');
    return;
  }

  const html = fs.readFileSync(indexPath, 'utf8');
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (m) => `'sha256-${crypto.createHash('sha256').update(m[1] ?? '', 'utf8').digest('base64')}'`,
  );
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`,
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "connect-src 'self' https://*.r2.cloudflarestorage.com",
    "worker-src 'self' blob:",
    'frame-src https://www.youtube-nocookie.com https://player.vimeo.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');

  app.use('/assets', express.static(path.join(root, 'assets'), { immutable: true, maxAge: '365d', index: false, fallthrough: false }));
  app.use(express.static(root, { index: false, maxAge: '1h' }));

  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path === '/api' || req.path.startsWith('/api/')) return next();
    res
      .set({
        'Content-Security-Policy': csp,
        'Cache-Control': 'no-cache',
        'X-Frame-Options': 'DENY',
        'Cross-Origin-Resource-Policy': 'same-origin',
      })
      .type('html')
      .send(html);
  });

  logger.info({ root }, '🖥️  Serving web client');
}
