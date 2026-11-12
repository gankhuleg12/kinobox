import type { Request, Response } from 'express';
import type { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { randomToken, safeEqual, sha256 } from '../../lib/crypto.js';
import { signAccessToken } from '../../lib/jwt.js';
import { logger } from '../../lib/logger.js';
import { mailer } from '../../lib/mailer.js';
import { sessionStore } from './session.store.js';
import { audit } from '../audit/audit.service.js';
import { settings } from '../settings/settings.service.js';

export const REFRESH_COOKIE = 'kb_rt';
const REFRESH_COOKIE_PATH = '/api/auth';
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const ROTATION_GRACE_MS = 30_000;

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
// Байхгүй хэрэглэгчийн үед ч ижил хугацаа зарцуулж user enumeration-аас сэргийлэх
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= argon2.hash('kinobox-dummy-password-1', ARGON_OPTS));

export const hashPassword = (pw: string) => argon2.hash(pw, ARGON_OPTS);

export function toPublicUser(u: Pick<User, 'id' | 'name' | 'email' | 'role' | 'avatarUrl' | 'locale' | 'passwordHash' | 'googleId' | 'createdAt'>) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    avatarUrl: u.avatarUrl,
    locale: u.locale,
    hasPassword: Boolean(u.passwordHash),
    googleLinked: Boolean(u.googleId),
    createdAt: u.createdAt,
  };
}

function deviceNameFromUA(ua: string | undefined): string {
  if (!ua) return 'Тодорхойгүй төхөөрөмж';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${browser} · ${os}`;
}

export function setRefreshCookie(res: Response, token: string, expires: Date) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    expires,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: env.isProd, sameSite: 'lax', path: REFRESH_COOKIE_PATH });
}

/**
 * Шинэ session үүсгэнэ. НЭГ АККАУНТ = НЭГ ТӨХӨӨРӨМЖ:
 * тухайн хэрэглэгчийн бусад бүх идэвхтэй session-ыг шууд хүчингүй болгоно.
 */
async function issueSession(user: User, req: Request, method: 'password' | 'google' | 'register') {
  const secret = randomToken(48);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  const ua = req.get('user-agent')?.slice(0, 500);

  const { session, revokedIds } = await prisma.$transaction(async (tx) => {
    const others = await tx.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (others.length) {
      await tx.session.updateMany({
        where: { id: { in: others.map((s) => s.id) } },
        data: { revokedAt: new Date(), revokeReason: 'NEW_LOGIN' },
      });
    }
    const session = await tx.session.create({
      data: {
        userId: user.id,
        refreshHash: sha256(secret),
        userAgent: ua,
        deviceName: deviceNameFromUA(ua),
        ip: req.ip?.slice(0, 45),
        expiresAt,
      },
    });
    await tx.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: req.ip?.slice(0, 45), failedLogins: 0, lockedUntil: null },
    });
    return { session, revokedIds: others.map((s) => s.id) };
  });

  await sessionStore.markRevoked(revokedIds);
  await sessionStore.markActive(session.id, user.id);

  audit({ actorId: user.id, action: `auth.login.${method}`, entityType: 'session', entityId: session.id, meta: { revokedSessions: revokedIds.length }, req });

  const accessToken = await signAccessToken({ sub: user.id, sid: session.id, role: user.role });
  return { accessToken, refreshToken: `${session.id}.${secret}`, refreshExpiresAt: expiresAt, kickedDevices: revokedIds.length };
}

export const authService = {
  issueSession,

  async register(req: Request, data: { name: string; email: string; password: string; locale?: string }) {
    const exists = await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } });
    if (exists) throw AppError.conflict('Энэ email хаягаар бүртгэл үүссэн байна', 'EMAIL_TAKEN');

    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash: await hashPassword(data.password),
        locale: data.locale ?? 'mn',
      },
    });
    audit({ actorId: user.id, action: 'auth.register', entityType: 'user', entityId: user.id, req });
    return { user, ...(await issueSession(user, req, 'register')) };
  },

  async login(req: Request, email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash) {
      await argon2.verify(await getDummyHash(), password).catch(() => false);
      throw AppError.unauthorized('Email эсвэл нууц үг буруу байна', 'INVALID_CREDENTIALS');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError(429, 'ACCOUNT_LOCKED', 'Олон удаа буруу оролдсон тул түр хугацаагаар түгжигдлээ. Дараа дахин оролдоно уу.');
    }

    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      const failed = user.failedLogins + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await prisma.user.update({
        where: { id: user.id },
        data: lock ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedLogins: failed },
      });
      audit({ actorId: user.id, action: lock ? 'auth.locked' : 'auth.login.failed', entityType: 'user', entityId: user.id, req });
      throw AppError.unauthorized('Email эсвэл нууц үг буруу байна', 'INVALID_CREDENTIALS');
    }
    if (user.status === 'BANNED') throw AppError.forbidden('Таны аккаунт хаагдсан байна', 'ACCOUNT_BANNED');

    // Argon2 параметр шинэчлэгдсэн бол hash-ийг шинэчилнэ
    if (argon2.needsRehash(user.passwordHash, ARGON_OPTS)) {
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
    }
    return { user, ...(await issueSession(user, req, 'password')) };
  },

  /**
   * Refresh token rotation + reuse detection.
   * Хуучин token дахин ашиглагдвал (хулгайлагдсан байж болзошгүй) session-ыг бүхэлд нь хүчингүй болгоно.
   * Олон tab зэрэг refresh хийх race-ийг 30 секундын grace-ээр зохицуулна.
   */
  async refresh(req: Request, token: string | undefined) {
    if (!token) throw AppError.unauthorized('Session олдсонгүй');
    const dot = token.indexOf('.');
    const sid = token.slice(0, dot);
    const secret = token.slice(dot + 1);
    if (dot < 1 || !secret || sid.length > 40) throw AppError.unauthorized('Session буруу');

    const session = await prisma.session.findUnique({ where: { id: sid }, include: { user: true } });
    if (!session || session.expiresAt < new Date()) throw AppError.unauthorized('Session дууссан');
    if (session.revokedAt) {
      throw AppError.unauthorized(
        session.revokeReason === 'NEW_LOGIN' ? 'Таны аккаунт өөр төхөөрөмжөөс нэвтэрсэн байна' : 'Session хүчингүй болсон',
        'SESSION_REVOKED',
      );
    }
    if (session.user.status === 'BANNED') throw AppError.forbidden('Таны аккаунт хаагдсан байна', 'ACCOUNT_BANNED');

    const hash = sha256(secret);
    let newRefreshToken: string | null = null;

    if (safeEqual(hash, session.refreshHash)) {
      const nextSecret = randomToken(48);
      const { count } = await prisma.session.updateMany({
        where: { id: sid, refreshHash: hash, revokedAt: null },
        data: { refreshHash: sha256(nextSecret), prevRefreshHash: hash, rotatedAt: new Date(), lastSeenAt: new Date(), ip: req.ip?.slice(0, 45) },
      });
      if (count === 1) newRefreshToken = `${sid}.${nextSecret}`;
      // count === 0 → өөр tab яг одоо rotate хийсэн; cookie-г тэр хүсэлт шинэчилнэ
    } else if (
      !(session.prevRefreshHash && safeEqual(hash, session.prevRefreshHash) && session.rotatedAt && Date.now() - session.rotatedAt.getTime() < ROTATION_GRACE_MS)
    ) {
      await prisma.session.update({ where: { id: sid }, data: { revokedAt: new Date(), revokeReason: 'TOKEN_REUSE' } });
      await sessionStore.markRevoked([sid]);
      audit({ actorId: session.userId, action: 'auth.refresh.reuse_detected', entityType: 'session', entityId: sid, req });
      logger.warn({ sid, userId: session.userId }, 'Refresh token reuse detected — session revoked');
      throw AppError.unauthorized('Session хүчингүй болсон', 'SESSION_REVOKED');
    }

    await sessionStore.markActive(sid, session.userId);
    const accessToken = await signAccessToken({ sub: session.userId, sid, role: session.user.role });
    return { user: session.user, accessToken, refreshToken: newRefreshToken, refreshExpiresAt: session.expiresAt };
  },

  async logout(req: Request, token: string | undefined) {
    const sid = req.auth?.sessionId ?? token?.split('.')[0];
    if (!sid) return;
    const where = req.auth ? { id: sid, userId: req.auth.userId } : { id: sid, refreshHash: sha256(token?.slice(sid.length + 1) ?? '') };
    const { count } = await prisma.session.updateMany({ where: { ...where, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'LOGOUT' } });
    if (count) {
      await sessionStore.markRevoked([sid]);
      audit({ action: 'auth.logout', entityType: 'session', entityId: sid, req });
    }
  },

  async revokeAllSessions(userId: string, reason: string) {
    const sessions = await prisma.session.findMany({ where: { userId, revokedAt: null }, select: { id: true } });
    if (!sessions.length) return 0;
    await prisma.session.updateMany({ where: { id: { in: sessions.map((s) => s.id) } }, data: { revokedAt: new Date(), revokeReason: reason } });
    await sessionStore.markRevoked(sessions.map((s) => s.id));
    return sessions.length;
  },

  async forgotPassword(req: Request, email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    // Хэрэглэгч байгаа эсэхээс үл хамааран ижил хариу буцаана (enumeration хамгаалалт)
    if (!user || user.status !== 'ACTIVE') return;

    const token = randomToken(32);
    await prisma.$transaction([
      prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) },
      }),
    ]);
    const link = `${env.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    audit({ actorId: user.id, action: 'auth.password_reset.requested', entityType: 'user', entityId: user.id, req });

    try {
      await mailer.sendPasswordReset(user.email, user.name, link, await settings.get('general.siteName'));
    } catch (err) {
      logger.error({ err }, 'Password reset email failed');
      if (env.isDev) logger.warn({ link }, 'DEV: password reset link');
    }
  },

  async resetPassword(req: Request, token: string, password: string) {
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw AppError.badRequest('Холбоос хүчингүй эсвэл хугацаа дууссан байна');
    }
    await prisma.$transaction([
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null },
      }),
    ]);
    await this.revokeAllSessions(record.userId, 'PASSWORD_RESET');
    audit({ actorId: record.userId, action: 'auth.password_reset.completed', entityType: 'user', entityId: record.userId, req });
  },

  async changePassword(req: Request, userId: string, current: string | undefined, next: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.passwordHash) {
      const ok = current ? await argon2.verify(user.passwordHash, current).catch(() => false) : false;
      if (!ok) throw AppError.badRequest('Одоогийн нууц үг буруу байна');
    }
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
    audit({ actorId: userId, action: 'auth.password_changed', entityType: 'user', entityId: userId, req });
  },
};
