import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimits } from '../../middleware/rateLimit.js';
import { validate, input, cleanString, emailSchema, passwordSchema } from '../../middleware/validate.js';
import { authService, toPublicUser, setRefreshCookie, clearRefreshCookie, REFRESH_COOKIE } from './auth.service.js';
import { googleService, GOOGLE_STATE_COOKIE, safeNext, type GoogleOAuthState } from './google.service.js';
import { entitlements } from '../access/entitlement.service.js';
import { settings } from '../settings/settings.service.js';
import { audit } from '../audit/audit.service.js';

export const authRouter = Router();

/**
 * Cookie-д суурилсан endpoint-уудад CSRF хамгаалалт: custom header шаардана.
 * Өөр домэйноос custom header-тэй хүсэлт илгээхэд CORS preflight шаардагдах тул
 * зөвшөөрөгдөөгүй origin-оос ирэх хүсэлт хаагдана.
 */
const requireClientHeader: RequestHandler = (req, _res, next) => {
  if (req.get('x-kb-client') !== 'web') throw AppError.forbidden('CSRF шалгалт амжилтгүй');
  next();
};

const registerBody = z.object({
  name: cleanString(100).pipe(z.string().min(2, 'Нэр хамгийн багадаа 2 тэмдэгт')),
  email: emailSchema,
  password: passwordSchema,
  locale: z.enum(['mn', 'en']).optional(),
});
const loginBody = z.object({ email: emailSchema, password: z.string().min(1).max(128) });

authRouter.get('/providers', async (_req, res) => {
  const g = await settings.getMany(['google.enabled', 'google.clientId', 'google.clientSecret']);
  res.set('Cache-Control', 'no-store').json({ google: g['google.enabled'] && Boolean(g['google.clientId'] && g['google.clientSecret']) });
});

authRouter.post('/register', rateLimits.authIp, rateLimits.register, requireClientHeader, validate({ body: registerBody }), async (req, res) => {
  const { body } = input<z.infer<typeof registerBody>>(req);
  const { user, accessToken, refreshToken, refreshExpiresAt } = await authService.register(req, body);
  setRefreshCookie(res, refreshToken, refreshExpiresAt);
  res.status(201).json({ accessToken, user: toPublicUser(user), subscription: await entitlements.summary(user.id) });
});

authRouter.post('/login', rateLimits.authIp, requireClientHeader, validate({ body: loginBody }), rateLimits.login, async (req, res) => {
  const { body } = input<z.infer<typeof loginBody>>(req);
  const { user, accessToken, refreshToken, refreshExpiresAt, kickedDevices } = await authService.login(req, body.email, body.password);
  setRefreshCookie(res, refreshToken, refreshExpiresAt);
  res.json({ accessToken, user: toPublicUser(user), subscription: await entitlements.summary(user.id), kickedDevices });
});

authRouter.post('/refresh', rateLimits.authIp, requireClientHeader, async (req, res) => {
  try {
    const { user, accessToken, refreshToken, refreshExpiresAt } = await authService.refresh(req, req.cookies?.[REFRESH_COOKIE]);
    if (refreshToken) setRefreshCookie(res, refreshToken, refreshExpiresAt);
    res.json({ accessToken, user: toPublicUser(user), subscription: await entitlements.summary(user.id) });
  } catch (err) {
    clearRefreshCookie(res);
    throw err;
  }
});

authRouter.post('/logout', requireClientHeader, async (req, res) => {
  await authService.logout(req, req.cookies?.[REFRESH_COOKIE]);
  clearRefreshCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
  if (!user) throw AppError.unauthorized();
  res.json({ user: toPublicUser(user), subscription: await entitlements.summary(user.id) });
});

const profileBody = z.object({
  name: cleanString(100).pipe(z.string().min(2)).optional(),
  locale: z.enum(['mn', 'en']).optional(),
});
authRouter.patch('/me', requireAuth, validate({ body: profileBody }), async (req, res) => {
  const { body } = input<z.infer<typeof profileBody>>(req);
  const user = await prisma.user.update({ where: { id: req.auth!.userId }, data: body });
  res.json({ user: toPublicUser(user) });
});

const changePasswordBody = z.object({ currentPassword: z.string().max(128).optional(), newPassword: passwordSchema });
authRouter.post('/change-password', requireAuth, rateLimits.sensitive, validate({ body: changePasswordBody }), async (req, res) => {
  const { body } = input<z.infer<typeof changePasswordBody>>(req);
  await authService.changePassword(req, req.auth!.userId, body.currentPassword, body.newPassword);
  res.status(204).end();
});

authRouter.post('/forgot-password', rateLimits.passwordReset, validate({ body: z.object({ email: emailSchema }) }), async (req, res) => {
  await authService.forgotPassword(req, input<{ email: string }>(req).body.email);
  res.json({ ok: true });
});

const resetBody = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
authRouter.post('/reset-password', rateLimits.passwordReset, validate({ body: resetBody }), async (req, res) => {
  const { body } = input<z.infer<typeof resetBody>>(req);
  await authService.resetPassword(req, body.token, body.password);
  res.json({ ok: true });
});

// ── Google OAuth
const stateCookieOpts = { httpOnly: true, secure: env.isProd, sameSite: 'lax' as const, path: '/api/auth/google', signed: true, maxAge: 10 * 60_000 };

authRouter.get('/google', rateLimits.authIp, async (req, res) => {
  const { url, state } = await googleService.buildAuthUrl(safeNext(req.query.next));
  res.cookie(GOOGLE_STATE_COOKIE, JSON.stringify(state), stateCookieOpts);
  res.redirect(302, url);
});

authRouter.get('/google/callback', rateLimits.authIp, async (req, res) => {
  const fail = (reason: string) => res.redirect(302, `${env.appUrl}/login?error=${encodeURIComponent(reason)}`);
  const raw = req.signedCookies?.[GOOGLE_STATE_COOKIE];
  res.clearCookie(GOOGLE_STATE_COOKIE, { ...stateCookieOpts, maxAge: undefined });

  try {
    if (typeof raw !== 'string') return fail('google_state');
    const st = JSON.parse(raw) as GoogleOAuthState;
    const { code, state, error } = req.query;
    if (error || typeof code !== 'string' || typeof state !== 'string' || state !== st.state) return fail('google_state');

    const profile = await googleService.exchange(code, st);
    const user = await googleService.findOrCreateUser(profile);
    if (user.status === 'BANNED') return fail('banned');

    const { refreshToken, refreshExpiresAt } = await authService.issueSession(user, req, 'google');
    setRefreshCookie(res, refreshToken, refreshExpiresAt);
    audit({ actorId: user.id, action: 'auth.google', entityType: 'user', entityId: user.id, req });
    // Токеныг URL-д хэзээ ч дамжуулахгүй: SPA нь /refresh-ээр access token авна
    return res.redirect(302, `${env.appUrl}/auth/callback?next=${encodeURIComponent(safeNext(st.next))}`);
  } catch (err) {
    logger.warn({ err }, 'Google OAuth callback failed');
    return fail('google');
  }
});
