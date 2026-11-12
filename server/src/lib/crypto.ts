import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const VERSION = 'v1';

/**
 * AES-256-GCM шифрлэлт. Гаралт: `v1:<iv>:<tag>:<ciphertext>` (base64url).
 * Version prefix нь ирээдүйд key rotation хийхэд зориулагдсан.
 */
export function encrypt(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join(':');
}

export function decrypt(payload: string, key: Buffer): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(':');
  if (version !== VERSION || !ivB64 || !tagB64 || dataB64 === undefined) {
    throw new Error('Unsupported ciphertext format');
  }
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}

export const sha256 = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');

export const hmacSha256 = (secret: string | Buffer, data: string | Buffer, encoding: 'hex' | 'base64' = 'hex') =>
  crypto.createHmac('sha256', secret).update(data).digest(encoding);

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Timing attack-аас хамгаалсан string харьцуулалт */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Уртын ялгаанаас мэдээлэл алдагдуулахгүйн тулд ижил хугацаатай харьцуулалт хийнэ
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••';
  return `••••••${value.slice(-4)}`;
}
