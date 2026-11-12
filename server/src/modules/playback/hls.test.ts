import { describe, it, expect } from 'vitest';
import { rewriteMaster, rewriteVariant, applyToken, TOKEN_PLACEHOLDER } from './hls.js';

const master = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5500000,RESOLUTION=1920x1080
1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720
720p/index.m3u8
`;

const variant = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x0123456789abcdef0123456789abcdef
#EXTINF:6.000000,
seg_00000.ts
#EXTINF:4.200000,
seg_00001.ts
#EXT-X-ENDLIST
`;

describe('rewriteMaster', () => {
  it('rewrites variant URIs to tokenized API paths', () => {
    const out = rewriteMaster(master, 'tok.en');
    expect(out).toContain('v/1080p.m3u8?t=tok.en');
    expect(out).toContain('v/720p.m3u8?t=tok.en');
    expect(out).not.toContain('index.m3u8');
    expect(out).toContain('#EXT-X-STREAM-INF:BANDWIDTH=5500000');
  });

  it('rejects path traversal in rendition names', () => {
    expect(() => rewriteMaster('#EXTM3U\n../../etc/index.m3u8\n', 't')).toThrow();
  });
});

describe('rewriteVariant', () => {
  it('presigns segments and replaces key URI with placeholder', async () => {
    const out = await rewriteVariant(variant, async (f) => `https://r2.example/${f}?sig=1`);
    expect(out).toContain('https://r2.example/seg_00000.ts?sig=1');
    expect(out).toContain('https://r2.example/seg_00001.ts?sig=1');
    expect(out).toContain(`URI="../key?t=${TOKEN_PLACEHOLDER}"`);
    expect(out).toContain('IV=0x0123456789abcdef0123456789abcdef');
    expect(out).not.toContain('key.bin');
  });

  it('rejects unsafe segment names', async () => {
    await expect(rewriteVariant('#EXTM3U\n../secret.ts\n', async (f) => f)).rejects.toThrow();
  });

  it('applyToken substitutes and URL-encodes the token', async () => {
    const cached = await rewriteVariant(variant, async (f) => f);
    expect(applyToken(cached, 'a b')).toContain('../key?t=a%20b');
    expect(applyToken(cached, 'x')).not.toContain(TOKEN_PLACEHOLDER);
  });
});
