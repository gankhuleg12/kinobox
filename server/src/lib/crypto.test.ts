import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { encrypt, decrypt, safeEqual, maskSecret, hmacSha256 } from './crypto.js';

const key = crypto.randomBytes(32);

describe('AES-256-GCM settings encryption', () => {
  it('round-trips plaintext', () => {
    const secret = 'sk_live_Монгол_🔐_123';
    const enc = encrypt(secret, key);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain(secret);
    expect(decrypt(enc, key)).toBe(secret);
  });

  it('produces different ciphertext each time (random IV)', () => {
    expect(encrypt('same', key)).not.toBe(encrypt('same', key));
  });

  it('rejects tampered ciphertext', () => {
    const parts = encrypt('payload', key).split(':');
    const data = Buffer.from(parts[3]!, 'base64url');
    data[0] = data[0]! ^ 0xff;
    parts[3] = data.toString('base64url');
    expect(() => decrypt(parts.join(':'), key)).toThrow();
  });

  it('rejects wrong key', () => {
    expect(() => decrypt(encrypt('payload', key), crypto.randomBytes(32))).toThrow();
  });
});

describe('helpers', () => {
  it('safeEqual compares correctly', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('maskSecret never reveals more than last 4 chars', () => {
    expect(maskSecret('supersecretvalue1234')).toBe('••••••1234');
    expect(maskSecret('short')).toBe('••••••');
  });

  it('hmacSha256 matches node implementation', () => {
    expect(hmacSha256('k', 'data')).toBe(crypto.createHmac('sha256', 'k').update('data').digest('hex'));
  });
});
