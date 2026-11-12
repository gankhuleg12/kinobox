import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { rateLimits } from '../../middleware/rateLimit.js';
import { moviesAdmin } from './movies.admin.js';
import { episodesAdmin } from './episodes.admin.js';
import { reelsAdmin } from './reels.admin.js';
import { categoriesAdmin, plansAdmin } from './catalog.admin.js';
import { usersAdmin, subscriptionsAdmin } from './users.admin.js';
import { paymentsAdmin } from './payments.admin.js';
import { statsAdmin, settingsAdmin, auditAdmin, facebookAdmin } from './system.admin.js';

/**
 * Admin API. Эрхийн түвшин:
 *  EDITOR — кино, ангилал, статистик
 *  ADMIN  — бүгд (үнэ, хэрэглэгч, төлбөр, тохиргоо, audit, Facebook bot)
 * Бүх өөрчлөлт audit log-д бичигдэнэ.
 */
export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('EDITOR'), rateLimits.admin, (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

adminRouter.use('/stats', statsAdmin);
adminRouter.use('/movies', moviesAdmin);
adminRouter.use('/episodes', episodesAdmin);
adminRouter.use('/reels', reelsAdmin);
adminRouter.use('/categories', categoriesAdmin);
adminRouter.use('/plans', plansAdmin);

const adminOnly = requireRole('ADMIN');
adminRouter.use('/users', adminOnly, usersAdmin);
adminRouter.use('/subscriptions', adminOnly, subscriptionsAdmin);
adminRouter.use('/payments', adminOnly, paymentsAdmin);
adminRouter.use('/settings', adminOnly, settingsAdmin);
adminRouter.use('/audit', adminOnly, auditAdmin);
adminRouter.use('/facebook', adminOnly, facebookAdmin);
