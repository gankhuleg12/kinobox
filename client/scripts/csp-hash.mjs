// dist/index.html дахь inline <script>-үүдийн sha256 hash-ийг тооцоолж nginx CSP-д оруулна.
// Ингэснээр 'unsafe-inline' ашиглахгүйгээр theme flash-аас сэргийлэх script ажиллана.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (inline.length !== 1) throw new Error(`Expected exactly 1 inline script, found ${inline.length}`);

const hash = createHash('sha256').update(inline[0], 'utf8').digest('base64');
const conf = readFileSync('nginx.conf', 'utf8').replaceAll('sha256-__THEME_SCRIPT_HASH__', `sha256-${hash}`);
writeFileSync('dist/nginx.conf', conf);
console.log(`CSP script hash: sha256-${hash}`);
