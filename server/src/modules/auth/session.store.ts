import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';

/**
 * Session-ий идэвхтэй эсэхийг Redis-д cache хийж, хүсэлт бүрт DB рүү хандахгүйгээр
 * шалгана. Нэг аккаунтаар шинэ төхөөрөмжөөс нэвтрэхэд хуучин session-ууд шууд
 * "0" болж, тухайн төхөөрөмжийн дараагийн хүсэлт 401 SESSION_REVOKED авна.
 */
const key = (sid: string) => `sess:${sid}`;
const TTL = 15 * 60;

export const sessionStore = {
  async isActive(sid: string, userId: string): Promise<boolean> {
    const cached = await redis.get(key(sid));
    if (cached !== null) return cached === userId;

    const s = await prisma.session.findUnique({
      where: { id: sid },
      select: { userId: true, revokedAt: true, expiresAt: true, user: { select: { status: true } } },
    });
    const active = Boolean(s && !s.revokedAt && s.expiresAt > new Date() && s.user.status === 'ACTIVE' && s.userId === userId);
    await redis.set(key(sid), active ? userId : '0', 'EX', TTL);
    return active;
  },

  async markActive(sid: string, userId: string) {
    await redis.set(key(sid), userId, 'EX', TTL);
  },

  async markRevoked(sids: string[]) {
    if (!sids.length) return;
    const pipeline = redis.pipeline();
    for (const sid of sids) pipeline.set(key(sid), '0', 'EX', TTL);
    await pipeline.exec();
  },
};
