import type { RequestHandler } from 'express';
import type { Role } from '@prisma/client';
import { verifyAccessToken } from '../lib/jwt.js';
import { AppError } from '../lib/errors.js';
import { sessionStore } from '../modules/auth/session.store.js';

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

async function authenticate(token: string) {
  const claims = await verifyAccessToken(token);
  const active = await sessionStore.isActive(claims.sid, claims.sub);
  if (!active) {
    throw AppError.unauthorized('Таны аккаунт өөр төхөөрөмжөөс нэвтэрсэн эсвэл session дууссан байна', 'SESSION_REVOKED');
  }
  return { userId: claims.sub, sessionId: claims.sid, role: claims.role };
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = extractBearer(req.get('authorization'));
  if (!token) throw AppError.unauthorized();
  req.auth = await authenticate(token);
  next();
};

/** Токен байвал танина, байхгүй эсвэл хүчингүй бол нэвтрээгүй гэж үзнэ */
export const optionalAuth: RequestHandler = async (req, _res, next) => {
  const token = extractBearer(req.get('authorization'));
  if (token) {
    try {
      req.auth = await authenticate(token);
    } catch {
      req.auth = undefined;
    }
  }
  next();
};

const RANK: Record<Role, number> = { USER: 0, EDITOR: 1, ADMIN: 2 };

export const requireRole =
  (min: Role): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) throw AppError.unauthorized();
    if (RANK[req.auth.role] < RANK[min]) throw AppError.forbidden();
    next();
  };
