import sharp, { type Metadata } from 'sharp';
import { r2 } from '../../lib/r2.js';
import { randomToken } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { POSTER_WIDTHS, BACKDROP_WIDTHS, STILL_WIDTHS } from '../catalog/catalog.mapper.js';

/**
 * Зургийг sharp-аар шалгаж (magic bytes), олон хэмжээтэй WebP болгон R2-д хадгална.
 * Frontend нь srcset ашиглан төхөөрөмжид тохирох хэмжээг л татна.
 */
const ALLOWED = new Set(['jpeg', 'png', 'webp', 'avif']);
const IMMUTABLE = 'public, max-age=31536000, immutable';

export type ImageKind = 'poster' | 'backdrop' | 'still';

const SPEC: Record<ImageKind, { widths: readonly number[]; aspect: number }> = {
  poster: { widths: POSTER_WIDTHS, aspect: 3 / 2 }, // 2:3 босоо
  backdrop: { widths: BACKDROP_WIDTHS, aspect: 9 / 16 }, // 16:9 хэвтээ
  still: { widths: STILL_WIDTHS, aspect: 9 / 16 }, // цувралын ангийн зураг
};

/** ownerId: кино эсвэл ангийн id (R2 зам) */
export async function processAndUploadImage(ownerId: string, kind: ImageKind, input: Buffer) {
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: 40_000_000 }).metadata();
  } catch {
    throw AppError.badRequest('Зургийн файл буруу байна');
  }
  if (!meta.format || !ALLOWED.has(meta.format)) throw AppError.badRequest('Зөвхөн JPEG, PNG, WebP, AVIF зураг зөвшөөрнө');
  if (!meta.width || meta.width < 300) throw AppError.badRequest('Зургийн өргөн хамгийн багадаа 300px байх ёстой');

  const spec = SPEC[kind];
  const baseKey = `${kind}s/${ownerId}/${randomToken(8)}`;

  // EXIF зэрэг metadata-г хасна (privacy), rotate нь EXIF orientation-ийг хэрэгжүүлнэ
  const pipeline = sharp(input).rotate();

  await Promise.all(
    spec.widths.map(async (w) => {
      const buf = await pipeline
        .clone()
        .resize({ width: w, height: Math.round(w * spec.aspect), fit: 'cover', position: 'attention', withoutEnlargement: false })
        .webp({ quality: 78, effort: 4 })
        .toBuffer();
      await r2.put('assets', `${baseKey}-${w}.webp`, buf, 'image/webp', IMMUTABLE, buf.length);
    }),
  );

  // Hover glow-д ашиглах давамгай өнгө
  const { dominant } = await sharp(input).resize(64, 64, { fit: 'cover' }).stats();
  const hex = `#${[dominant.r, dominant.g, dominant.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

  return { key: baseKey, color: hex };
}

export async function deleteImageSet(kind: ImageKind, baseKey: string | null) {
  if (!baseKey) return;
  await r2.deleteKeys('assets', SPEC[kind].widths.map((w) => `${baseKey}-${w}.webp`)).catch(() => undefined);
}
