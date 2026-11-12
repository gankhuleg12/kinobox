import type { RequestHandler } from 'express';
import { z } from 'zod';

interface Schemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

/**
 * zod schema-аар body/query/params-ийг баталгаажуулна.
 * Баталгаажсан утгыг `req.valid`-д хадгална. Тодорхойгүй талбарууд хасагдана
 * (mass-assignment-аас хамгаална).
 */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    req.valid ??= {};
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      req.valid[part] = schema.parse(req[part] ?? {});
    }
    next();
  };

/** Typed helper: controller дотор `input<Body>(req).body` гэх мэтээр ашиглана */
export function input<B = unknown, Q = unknown, P = unknown>(req: { valid: { body?: unknown; query?: unknown; params?: unknown } }) {
  return req.valid as { body: B; query: Q; params: P };
}

// ── Нийтлэг schema-ууд
// eslint-disable-next-line no-control-regex
const controlChars = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const tagChars = /[<>]/g;

/** Control тэмдэгт болон HTML tag тэмдэгт хасаж, trim хийсэн string (XSS defense-in-depth) */
export const cleanString = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(controlChars, '').replace(tagChars, '').trim())
    .pipe(z.string().max(max));

/** Олон мөрт текст (тайлбар): мөр шилжилтийг үлдээнэ */
export const cleanText = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(controlChars, '').replace(tagChars, '').trim())
    .pipe(z.string().max(max));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(191)
  .pipe(z.email({ message: 'Email хаяг буруу байна' }));

export const passwordSchema = z
  .string()
  .min(8, 'Нууц үг хамгийн багадаа 8 тэмдэгт')
  .max(128, 'Нууц үг хэт урт')
  .refine((p) => /\p{L}/u.test(p) && /\d/.test(p), 'Нууц үг үсэг болон тоо агуулсан байх ёстой');

export const idParam = z.object({ id: z.string().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/) });
export const intIdParam = z.object({ id: z.coerce.number().int().positive() });
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug зөвхөн латин жижиг үсэг, тоо, зураас агуулна');

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

export const paginate = (page: number, limit: number) => ({ skip: (page - 1) * limit, take: limit });
