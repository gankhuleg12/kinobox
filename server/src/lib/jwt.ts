import { SignJWT, jwtVerify, errors } from 'jose';
import { env } from '../config/env.js';
import { AppError } from './errors.js';

const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const playbackKey = new TextEncoder().encode(env.JWT_PLAYBACK_SECRET);
const ISSUER = 'kinobox';

export interface AccessClaims {
  sub: string;
  sid: string;
  role: 'USER' | 'EDITOR' | 'ADMIN';
}

export interface PlaybackClaims {
  sub: string;
  sid: string;
  /** media id: кино эсвэл ангийн id */
  mid: string;
  kind: 'movie' | 'episode';
}

export async function signAccessToken(claims: AccessClaims) {
  return new SignJWT({ sid: claims.sid, role: claims.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience('api')
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SEC}s`)
    .sign(accessKey);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, accessKey, { issuer: ISSUER, audience: 'api', algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') throw new Error('bad claims');
    return { sub: payload.sub, sid: payload.sid, role: payload.role as AccessClaims['role'] };
  } catch (err) {
    if (err instanceof errors.JWTExpired) throw AppError.unauthorized('Токены хугацаа дууссан', 'TOKEN_EXPIRED');
    throw AppError.unauthorized('Токен буруу байна');
  }
}

export async function signPlaybackToken(claims: PlaybackClaims) {
  return new SignJWT({ sid: claims.sid, mid: claims.mid, k: claims.kind })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience('playback')
    .setIssuedAt()
    .setExpirationTime(`${env.PLAYBACK_TOKEN_TTL_SEC}s`)
    .sign(playbackKey);
}

export async function verifyPlaybackToken(token: string): Promise<PlaybackClaims> {
  try {
    const { payload } = await jwtVerify(token, playbackKey, { issuer: ISSUER, audience: 'playback', algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || typeof payload.mid !== 'string') {
      throw new Error('bad claims');
    }
    return { sub: payload.sub, sid: payload.sid, mid: payload.mid, kind: payload.k === 'episode' ? 'episode' : 'movie' };
  } catch {
    throw AppError.unauthorized('Тоглуулах эрхийн токен хүчингүй');
  }
}
