import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { paymentsService } from '../modules/payments/payments.service.js';

/**
 * 5 минут тутамд:
 *  - Webhook ирээгүй төлбөрийг провайдерын API-аас шалгах (тохиргоогоор)
 *  - Хугацаа дууссан төлбөр/багцыг тэмдэглэх, хуучин session цэвэрлэх
 *  - 24 цагаас дээш "UPLOADING" төлөвт гацсан (орхигдсон) upload-ыг буцаах
 */
export async function runMaintenance() {
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  const dayAgo = new Date(now.getTime() - 86_400_000);

  const reconciled = await paymentsService.reconcilePending().catch((err) => {
    logger.warn({ err }, 'reconcilePending failed');
    return 0;
  });

  const staleUpload = { videoStatus: 'UPLOADING' as const, updatedAt: { lt: dayAgo } };
  const [expiredPayments, expiredSubs, deletedSessions, deletedTokens, ...stale] = await Promise.all([
    paymentsService.expireStale(),
    prisma.subscription.updateMany({ where: { status: 'ACTIVE', endsAt: { lt: now } }, data: { status: 'EXPIRED' } }).then((r) => r.count),
    prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: monthAgo } }] } }).then((r) => r.count),
    prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: monthAgo } } }).then((r) => r.count),
    prisma.movie.updateMany({ where: { ...staleUpload, hlsPath: null }, data: { videoStatus: 'NONE', videoProgress: 0 } }).then((r) => r.count),
    prisma.movie.updateMany({ where: { ...staleUpload, hlsPath: { not: null } }, data: { videoStatus: 'READY', videoProgress: 100 } }).then((r) => r.count),
    prisma.episode.updateMany({ where: { ...staleUpload, hlsPath: null }, data: { videoStatus: 'NONE', videoProgress: 0 } }).then((r) => r.count),
    prisma.episode.updateMany({ where: { ...staleUpload, hlsPath: { not: null } }, data: { videoStatus: 'READY', videoProgress: 100 } }).then((r) => r.count),
    prisma.reel.updateMany({ where: { ...staleUpload, videoKey: null }, data: { videoStatus: 'NONE', videoProgress: 0 } }).then((r) => r.count),
    prisma.reel.updateMany({ where: { ...staleUpload, videoKey: { not: null } }, data: { videoStatus: 'READY', videoProgress: 100 } }).then((r) => r.count),
  ]);
  const staleUploads = stale.reduce((a, b) => a + b, 0);

  if (reconciled || expiredPayments || expiredSubs || deletedSessions || deletedTokens || staleUploads) {
    logger.info({ reconciled, expiredPayments, expiredSubs, deletedSessions, deletedTokens, staleUploads }, 'Maintenance sweep');
  }
}
