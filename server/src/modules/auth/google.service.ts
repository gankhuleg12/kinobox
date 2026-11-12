import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { randomToken } from '../../lib/crypto.js';
import { settings } from '../settings/settings.service.js';

/**
 * Google OAuth 2.0 Authorization Code + PKCE урсгал.
 * id_token-ийг Google-ийн JWKS-ээр гарын үсэг, audience, issuer, nonce-оор шалгана.
 */
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export const GOOGLE_STATE_COOKIE = 'kb_g';
export const callbackUrl = () => `${env.apiUrl}/api/auth/google/callback`;

export interface GoogleOAuthState {
  state: string;
  verifier: string;
  nonce: string;
  next: string;
}

async function credentials() {
  const enabled = await settings.get('google.enabled');
  if (!enabled) throw AppError.notConfigured('Google нэвтрэлт');
  return settings.require(['google.clientId', 'google.clientSecret'], 'Google OAuth');
}

/** Open redirect-аас сэргийлж зөвхөн дотоод зам зөвшөөрнө */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
  return next.slice(0, 300);
}

export const googleService = {
  async buildAuthUrl(next: string) {
    const creds = await credentials();
    const st: GoogleOAuthState = { state: randomToken(24), verifier: randomToken(48), nonce: randomToken(24), next: safeNext(next) };
    const challenge = crypto.createHash('sha256').update(st.verifier).digest('base64url');
    const url = new URL(GOOGLE_AUTH_URL);
    url.search = new URLSearchParams({
      client_id: creds['google.clientId'],
      redirect_uri: callbackUrl(),
      response_type: 'code',
      scope: 'openid email profile',
      state: st.state,
      nonce: st.nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return { url: url.toString(), state: st };
  },

  async exchange(code: string, st: GoogleOAuthState) {
    const creds = await credentials();
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: creds['google.clientId'],
        client_secret: creds['google.clientSecret'],
        redirect_uri: callbackUrl(),
        grant_type: 'authorization_code',
        code_verifier: st.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw AppError.unauthorized('Google нэвтрэлт амжилтгүй');
    const body = (await res.json()) as { id_token?: string };
    if (!body.id_token) throw AppError.unauthorized('Google id_token ирсэнгүй');

    const { payload } = await jwtVerify(body.id_token, JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: creds['google.clientId'],
    });
    if (payload.nonce !== st.nonce) throw AppError.unauthorized('Google nonce таарахгүй байна');
    if (payload.email_verified !== true || typeof payload.email !== 'string' || typeof payload.sub !== 'string') {
      throw AppError.unauthorized('Google email баталгаажаагүй байна');
    }
    return {
      googleId: payload.sub,
      email: payload.email.toLowerCase(),
      name: typeof payload.name === 'string' ? payload.name.slice(0, 100) : payload.email.split('@')[0]!,
      picture: typeof payload.picture === 'string' ? payload.picture.slice(0, 500) : null,
    };
  },

  /** googleId-аар олно → email-ээр олж холбоно → шинээр үүсгэнэ */
  async findOrCreateUser(profile: { googleId: string; email: string; name: string; picture: string | null }) {
    const byGoogle = await prisma.user.findUnique({ where: { googleId: profile.googleId } });
    if (byGoogle) return byGoogle;

    const byEmail = await prisma.user.findUnique({ where: { email: profile.email } });
    if (byEmail) {
      return prisma.user.update({
        where: { id: byEmail.id },
        data: { googleId: profile.googleId, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(), avatarUrl: byEmail.avatarUrl ?? profile.picture },
      });
    }
    return prisma.user.create({
      data: { name: profile.name, email: profile.email, googleId: profile.googleId, avatarUrl: profile.picture, emailVerifiedAt: new Date() },
    });
  },
};
