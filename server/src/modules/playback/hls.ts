/**
 * HLS playlist дахин бичих цэвэр функцууд (unit test хийгдсэн).
 *
 * Аюулгүй байдлын загвар:
 *  - Master/variant playlist нь зөвхөн манай API-аар, хүчинтэй playback token-оор ирнэ.
 *  - Segment-үүд R2-оос богино хугацааны presigned URL-аар шууд татагдана (сервер ачаалалгүй).
 *  - Segment бүр AES-128-аар шифрлэгдсэн; түлхүүр нь зөвхөн token + идэвхтэй session-тэй
 *    хэрэглэгчид `/key` endpoint-оор олгогдоно. Тиймээс segment URL алдагдсан ч ашиггүй.
 */
export const TOKEN_PLACEHOLDER = '__KB_TOKEN__';
const SAFE_NAME = /^[A-Za-z0-9_.-]{1,120}$/;
const SAFE_RENDITION = /^[A-Za-z0-9_]{1,20}$/;

export const isSafeRendition = (r: string) => SAFE_RENDITION.test(r);

/** "720p/index.m3u8" → "v/720p.m3u8?t=TOKEN" (master playlist-ийн URL-д харьцангуй) */
export function rewriteMaster(master: string, token: string): string {
  const variantUri = (uri: string) => {
    const rendition = uri.split('/')[0] ?? '';
    if (!isSafeRendition(rendition)) throw new Error(`Unsafe rendition in master playlist: ${uri}`);
    return `v/${rendition}.m3u8?t=${encodeURIComponent(token)}`;
  };
  return master
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) return line.replace(/URI="([^"]+)"/, (_m, uri: string) => `URI="${variantUri(uri)}"`);
      return variantUri(trimmed);
    })
    .join('\n');
}

/**
 * Variant playlist: segment мөрүүдийг presigned URL болгож, KEY URI-г placeholder-оор солино.
 * Үр дүн нь хэрэглэгчээс хамааралгүй тул cache хийгдэнэ; хүсэлт бүрт зөвхөн placeholder-ийг солино.
 */
export async function rewriteVariant(playlist: string, presign: (fileName: string) => Promise<string>): Promise<string> {
  const lines = playlist.split(/\r?\n/);
  const out = await Promise.all(
    lines.map(async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#EXT-X-KEY')) {
        return line.replace(/URI="[^"]*"/, `URI="../key?t=${TOKEN_PLACEHOLDER}"`);
      }
      if (trimmed.startsWith('#EXT-X-MAP')) {
        const m = /URI="([^"]+)"/.exec(trimmed);
        if (!m?.[1] || !SAFE_NAME.test(m[1])) throw new Error('Unsafe EXT-X-MAP uri');
        return line.replace(/URI="[^"]+"/, `URI="${await presign(m[1])}"`);
      }
      if (trimmed.startsWith('#')) return line;
      if (!SAFE_NAME.test(trimmed)) throw new Error(`Unsafe segment name: ${trimmed}`);
      return presign(trimmed);
    }),
  );
  return out.join('\n');
}

export const applyToken = (cachedVariant: string, token: string) => cachedVariant.split(TOKEN_PLACEHOLDER).join(encodeURIComponent(token));
