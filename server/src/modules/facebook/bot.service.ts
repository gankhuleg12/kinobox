import { Prisma, type Movie } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { hmacSha256, safeEqual } from '../../lib/crypto.js';
import type { FacebookJob } from '../../lib/queue.js';
import { settings } from '../settings/settings.service.js';
import { catalogService } from '../catalog/catalog.service.js';
import { graphClient, type Recipient } from './graph.client.js';

/** Код хадгалах/хайх нэгдсэн хэлбэр: зай, # хасаж, том үсэг */
export const normalizeCode = (code: string) => code.trim().replace(/^#/, '').replace(/\s+/g, '').toUpperCase().slice(0, 20);

/** Comment/мессежээс киноны код гаргах: "1", " #1 ", "1!", "A12 үзье" гэх мэт */
export function extractCodeCandidates(text: string): string[] {
  const cleaned = text.trim().replace(/[.,!?。]+$/g, '');
  if (!cleaned || cleaned.length > 60) return [];
  const first = cleaned.split(/\s+/)[0] ?? '';
  return [...new Set([normalizeCode(cleaned), normalizeCode(first)])].filter((c) => /^[A-Z0-9_-]{1,20}$/.test(c));
}

export function verifyFacebookSignature(appSecret: string, rawBody: Buffer, header: string | undefined) {
  if (!header?.startsWith('sha256=')) return false;
  return safeEqual(`sha256=${hmacSha256(appSecret, rawBody)}`, header);
}

const fmt = (n: number) => n.toLocaleString('en-US');
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function buildMovieMessage(movie: Movie) {
  const s = await settings.getMany([
    'facebook.templateStyle',
    'facebook.messageTemplate',
    'facebook.rentButtonLabel',
    'facebook.planButtonLabel',
    'pricing.defaultRentPrice',
    'pricing.defaultRentHours',
    'r2.assetsPublicUrl',
  ]);
  const plan = await catalogService.planForPricing();
  const rentPrice = movie.rentPrice ?? s['pricing.defaultRentPrice'];
  const rentHours = movie.rentHours ?? s['pricing.defaultRentHours'];
  const movieUrl = `${env.appUrl}/movie/${movie.slug}?src=fb`;
  const showPlan = Boolean(plan) && movie.accessType === 'SUBSCRIPTION';

  const vars: Record<string, string> = {
    title: movie.title,
    year: movie.releaseYear ? String(movie.releaseYear) : '',
    description: truncate(movie.description.replace(/\s+/g, ' '), 280),
    rentPrice: fmt(rentPrice),
    rentHours: String(rentHours),
    planName: plan?.nameMn ?? '',
    planPrice: plan ? fmt(plan.price) : '',
    url: movieUrl,
  };
  // Хамааралгүй мөрийг (жишээ нь RENT_ONLY кинонд сарын багцын мөр) загвараас хасна
  const dropLinesWith = (lines: string[], keys: string[]) => lines.filter((l) => !keys.some((k) => l.includes(`{${k}}`)));
  let lines = s['facebook.messageTemplate'].split('\n');
  if (!showPlan) lines = dropLinesWith(lines, ['planName', 'planPrice']);
  if (movie.accessType === 'FREE') lines = dropLinesWith(lines, ['rentPrice', 'rentHours']);
  const text = lines
    .join('\n')
    .replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '')
    .replace(/\s*\(\)/g, '')
    .trim();

  const buttons: { type: 'web_url'; url: string; title: string }[] = [];
  if (movie.accessType === 'FREE') {
    buttons.push({ type: 'web_url', url: movieUrl, title: 'Үзэх' });
  } else {
    buttons.push({ type: 'web_url', url: `${env.appUrl}/checkout/rent/${movie.slug}?src=fb`, title: truncate(s['facebook.rentButtonLabel'], 20) });
    if (showPlan && plan) {
      buttons.push({ type: 'web_url', url: `${env.appUrl}/checkout/plan/${plan.code}?src=fb`, title: truncate(s['facebook.planButtonLabel'], 20) });
    }
  }

  if (s['facebook.templateStyle'] === 'button' || !movie.posterKey || !s['r2.assetsPublicUrl']) {
    return { attachment: { type: 'template', payload: { template_type: 'button', text: truncate(text, 640), buttons } } };
  }

  const subtitleParts = [movie.accessType !== 'FREE' ? `1 кино: ${fmt(rentPrice)}₮/${rentHours}ц` : 'Үнэгүй'];
  if (movie.kind === 'SERIES' && movie.freeEpisodes > 0 && movie.accessType !== 'FREE') subtitleParts.unshift(`${movie.freeEpisodes} анги үнэгүй`);
  if (showPlan && plan) subtitleParts.push(`${plan.nameMn}: ${fmt(plan.price)}₮`);
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'generic',
        image_aspect_ratio: 'square',
        elements: [
          {
            title: truncate(vars.year ? `${movie.title} (${vars.year})` : movie.title, 80),
            subtitle: truncate(subtitleParts.join(' · '), 80),
            image_url: `${s['r2.assetsPublicUrl']}/${movie.posterKey}-720.webp`,
            default_action: { type: 'web_url', url: movieUrl },
            buttons,
          },
        ],
      },
    },
  };
}

/** Worker дотор ажиллана. Idempotent: нэг comment/мессежид зөвхөн нэг удаа хариулна. */
export async function processFacebookEvent(job: FacebookJob) {
  const existing = await prisma.fbBotEvent.findUnique({ where: { externalId: job.externalId } });
  if (existing && existing.status !== 'FAILED' && existing.status !== 'RECEIVED') return existing.status;

  const event =
    existing ??
    (await prisma.fbBotEvent
      .create({
        data: {
          kind: job.kind,
          externalId: job.externalId,
          postId: job.postId,
          senderId: job.senderId,
          senderName: job.senderName?.slice(0, 191),
          text: job.text.slice(0, 1000),
        },
      })
      .catch(async (err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return prisma.fbBotEvent.findUniqueOrThrow({ where: { externalId: job.externalId } });
        }
        throw err;
      }));

  const update = (data: Prisma.FbBotEventUpdateInput) => prisma.fbBotEvent.update({ where: { id: event.id }, data });

  const cfg = await settings.getMany(['facebook.enabled', 'facebook.pageId', 'facebook.publicReplyEnabled', 'facebook.publicReplyText', 'facebook.unknownCodeReply']);
  if (!cfg['facebook.enabled']) {
    await update({ status: 'SKIPPED', error: 'Bot disabled' });
    return 'SKIPPED';
  }
  if (job.senderId === cfg['facebook.pageId']) {
    await update({ status: 'SKIPPED', error: 'Page own message' });
    return 'SKIPPED';
  }

  const candidates = extractCodeCandidates(job.text);
  const movie = candidates.length
    ? await prisma.movie.findFirst({ where: { fbCode: { in: candidates }, status: 'PUBLISHED' } })
    : null;

  try {
    if (!movie) {
      // Чатын жирийн мессежид хариулахгүй — зөвхөн код шиг богино текстэд
      if (job.kind === 'MESSAGE' && candidates.length && job.text.trim().length <= 10 && cfg['facebook.unknownCodeReply']) {
        await graphClient.sendMessage({ id: job.senderId }, { text: cfg['facebook.unknownCodeReply'] });
      }
      await update({ status: 'NO_MATCH', code: candidates[0] ?? null });
      return 'NO_MATCH';
    }

    const recipient: Recipient = job.kind === 'COMMENT' ? { comment_id: job.externalId } : { id: job.senderId };
    await graphClient.sendMessage(recipient, await buildMovieMessage(movie));

    if (job.kind === 'COMMENT' && cfg['facebook.publicReplyEnabled'] && cfg['facebook.publicReplyText']) {
      await graphClient.replyToComment(job.externalId, cfg['facebook.publicReplyText']).catch((err) => {
        logger.warn({ err: err.message, commentId: job.externalId }, 'Public comment reply failed');
      });
    }
    await update({ status: 'SENT', code: movie.fbCode, movieId: movie.id, error: null });
    return 'SENT';
  } catch (err) {
    const message = err instanceof Error ? err.message : 'error';
    await update({ status: 'FAILED', error: message.slice(0, 500), movieId: movie?.id ?? null });
    throw err;
  }
}

/** Facebook webhook payload-оос боловсруулах event-үүдийг ялгаж авна */
export function extractJobs(body: unknown, pageId: string): FacebookJob[] {
  const jobs: FacebookJob[] = [];
  const root = body as { object?: string; entry?: unknown[] };
  if (root?.object !== 'page' || !Array.isArray(root.entry)) return jobs;

  for (const entryRaw of root.entry) {
    const entry = entryRaw as { changes?: unknown[]; messaging?: unknown[] };

    for (const changeRaw of entry.changes ?? []) {
      const change = changeRaw as { field?: string; value?: Record<string, unknown> };
      const v = change.value;
      if (change.field !== 'feed' || !v || v.item !== 'comment' || v.verb !== 'add') continue;
      const from = v.from as { id?: string; name?: string } | undefined;
      if (typeof v.comment_id !== 'string' || typeof v.message !== 'string' || !from?.id || from.id === pageId) continue;
      jobs.push({
        kind: 'COMMENT',
        externalId: v.comment_id,
        postId: typeof v.post_id === 'string' ? v.post_id : undefined,
        senderId: from.id,
        senderName: from.name,
        text: v.message,
      });
    }

    for (const msgRaw of entry.messaging ?? []) {
      const m = msgRaw as { sender?: { id?: string }; message?: { mid?: string; text?: string; is_echo?: boolean } };
      if (!m.sender?.id || !m.message?.mid || m.message.is_echo || typeof m.message.text !== 'string') continue;
      if (m.sender.id === pageId) continue;
      jobs.push({ kind: 'MESSAGE', externalId: m.message.mid, senderId: m.sender.id, text: m.message.text });
    }
  }
  return jobs;
}
