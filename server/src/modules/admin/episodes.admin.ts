import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { r2 } from '../../lib/r2.js';
import { cache, CacheNs } from '../../lib/cache.js';
import { AppError } from '../../lib/errors.js';
import { validate, input, idParam, cleanString, cleanText } from '../../middleware/validate.js';
import { audit } from '../audit/audit.service.js';
import { settings } from '../settings/settings.service.js';
import { processAndUploadImage, deleteImageSet } from '../media/image.service.js';
import { imageSet, STILL_WIDTHS } from '../catalog/catalog.mapper.js';
import { videoUploadRouter } from './video-upload.js';

/** Цувралын ангиуд (EDITOR+) */
export const episodesAdmin = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
const invalidate = () => cache.bump(CacheNs.catalog);

const episodeBody = z.object({
  seasonNumber: z.number().int().min(1).max(100),
  episodeNumber: z.number().int().min(1).max(5000),
  title: cleanString(200).nullish(),
  titleEn: cleanString(200).nullish(),
  description: cleanText(3000).nullish(),
  isPublished: z.boolean().optional(),
});
type EpisodeBody = z.infer<typeof episodeBody>;

async function requireSeries(movieId: string) {
  const m = await prisma.movie.findUnique({ where: { id: movieId }, select: { id: true, kind: true, freeEpisodes: true } });
  if (!m) throw AppError.notFound('Кино олдсонгүй');
  if (m.kind !== 'SERIES') throw AppError.badRequest('Зөвхөн цуврал төрлийн кинонд анги нэмнэ');
  return m;
}

episodesAdmin.get('/', validate({ query: z.object({ movieId: idParam.shape.id }) }), async (req, res) => {
  const { query } = input<unknown, { movieId: string }>(req);
  const movie = await requireSeries(query.movieId);
  const [rows, base] = await Promise.all([
    prisma.episode.findMany({ where: { movieId: movie.id }, orderBy: [{ seasonNumber: 'asc' }, { episodeNumber: 'asc' }] }),
    settings.get('r2.assetsPublicUrl'),
  ]);
  // Үнэгүй эсэхийг нийтлэгдсэн ангиудын дарааллаар тооцно (хэрэглэгчийн талтай ижил дүрэм)
  let publishedIndex = 0;
  res.json(
    rows.map(({ hlsKeyEnc: _k, stillKey, ...e }) => ({
      ...e,
      still: imageSet(base, stillKey, STILL_WIDTHS, 320),
      isFree: e.isPublished ? publishedIndex++ < movie.freeEpisodes : false,
    })),
  );
});

episodesAdmin.post('/', validate({ body: episodeBody.extend({ movieId: idParam.shape.id }) }), async (req, res) => {
  const { body } = input<EpisodeBody & { movieId: string }>(req);
  await requireSeries(body.movieId);
  const ep = await prisma.episode.create({ data: body });
  await invalidate();
  audit({ action: 'episode.create', entityType: 'episode', entityId: ep.id, meta: { movieId: body.movieId, s: body.seasonNumber, e: body.episodeNumber }, req });
  res.status(201).json({ id: ep.id });
});

episodesAdmin.patch('/:id', validate({ params: idParam, body: episodeBody.partial() }), async (req, res) => {
  const { params, body } = input<Partial<EpisodeBody>, unknown, { id: string }>(req);
  const ep = await prisma.episode.update({ where: { id: params.id }, data: body, select: { id: true } });
  await invalidate();
  audit({ action: 'episode.update', entityType: 'episode', entityId: ep.id, meta: { fields: Object.keys(body) }, req });
  res.json(ep);
});

episodesAdmin.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  const ep = await prisma.episode.findUnique({ where: { id: params.id } });
  if (!ep) throw AppError.notFound();
  await prisma.episode.delete({ where: { id: ep.id } });
  await invalidate();
  audit({ action: 'episode.delete', entityType: 'episode', entityId: ep.id, meta: { movieId: ep.movieId }, req });
  void Promise.allSettled([
    deleteImageSet('still', ep.stillKey),
    r2.deletePrefix('media', `movies/${ep.movieId}/episodes/${ep.id}/`),
    r2.deletePrefix('media', `sources/${ep.movieId}/episodes/${ep.id}/`),
  ]);
  res.status(204).end();
});

episodesAdmin.post('/:id/still', validate({ params: idParam }), upload.single('file'), async (req, res) => {
  const { params } = input<unknown, unknown, { id: string }>(req);
  if (!req.file) throw AppError.badRequest('Файл сонгоно уу');
  const ep = await prisma.episode.findUnique({ where: { id: params.id }, select: { id: true, stillKey: true } });
  if (!ep) throw AppError.notFound();
  const { key } = await processAndUploadImage(ep.id, 'still', req.file.buffer);
  await prisma.episode.update({ where: { id: ep.id }, data: { stillKey: key } });
  await deleteImageSet('still', ep.stillKey);
  await invalidate();
  res.json({ key });
});

episodesAdmin.use('/:id/video', videoUploadRouter('episode'));
