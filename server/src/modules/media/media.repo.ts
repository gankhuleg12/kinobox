import type { Prisma, VideoStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Видеотой гурван төрлийн объектыг (кино, цувралын анги, reel) upload/transcode
 * pipeline-д нэг интерфейсээр ашиглах abstraction.
 */
export type MediaType = 'movie' | 'episode' | 'reel';
export const MEDIA_TYPES: readonly MediaType[] = ['movie', 'episode', 'reel'];

export interface MediaRecord {
  type: MediaType;
  id: string;
  sourceKey: string | null;
  videoStatus: VideoStatus;
  /** HLS (кино/анги) эсвэл MP4 (reel) гаралт байгаа эсэх */
  hasOutput: boolean;
  hlsPath: string | null;
  videoKey: string | null;
  posterKey: string | null;
  durationSec: number | null;
  /** R2 дээрх гаралтын prefix */
  storagePrefix: string;
  /** R2 дээрх эх файлын prefix */
  sourcePrefix: string;
  /** Кино нь цуврал эсэх (кино түвшинд видео upload хийхийг хориглоход) */
  isSeries: boolean;
}

export interface CommonUpdate {
  videoStatus?: VideoStatus;
  videoProgress?: number;
  videoError?: string | null;
  sourceKey?: string | null;
}

export interface HlsOutput {
  hlsPath: string;
  hlsKeyEnc: string;
  durationSec: number | null;
  renditions: Prisma.InputJsonValue;
}

export interface ReelOutput {
  videoKey: string;
  posterKey: string;
  durationSec: number;
  width: number;
  height: number;
}

export const mediaRepo = {
  async get(type: MediaType, id: string): Promise<MediaRecord | null> {
    if (type === 'movie') {
      const m = await prisma.movie.findUnique({ where: { id }, select: { id: true, kind: true, sourceKey: true, videoStatus: true, hlsPath: true, durationSec: true } });
      return m
        ? {
            type, id, sourceKey: m.sourceKey, videoStatus: m.videoStatus, hasOutput: Boolean(m.hlsPath), hlsPath: m.hlsPath, videoKey: null, posterKey: null,
            durationSec: m.durationSec, storagePrefix: `movies/${id}`, sourcePrefix: `sources/${id}`, isSeries: m.kind === 'SERIES',
          }
        : null;
    }
    if (type === 'episode') {
      const e = await prisma.episode.findUnique({ where: { id }, select: { id: true, movieId: true, sourceKey: true, videoStatus: true, hlsPath: true, durationSec: true } });
      return e
        ? {
            type, id, sourceKey: e.sourceKey, videoStatus: e.videoStatus, hasOutput: Boolean(e.hlsPath), hlsPath: e.hlsPath, videoKey: null, posterKey: null,
            durationSec: e.durationSec, storagePrefix: `movies/${e.movieId}/episodes/${id}`, sourcePrefix: `sources/${e.movieId}/episodes/${id}`, isSeries: false,
          }
        : null;
    }
    const r = await prisma.reel.findUnique({ where: { id }, select: { id: true, sourceKey: true, videoStatus: true, videoKey: true, posterKey: true, durationSec: true } });
    return r
      ? {
          type, id, sourceKey: r.sourceKey, videoStatus: r.videoStatus, hasOutput: Boolean(r.videoKey), hlsPath: null, videoKey: r.videoKey, posterKey: r.posterKey,
          durationSec: r.durationSec, storagePrefix: `reels/${id}`, sourcePrefix: `sources/reels/${id}`, isSeries: false,
        }
      : null;
  },

  async update(type: MediaType, id: string, data: CommonUpdate) {
    switch (type) {
      case 'movie':
        await prisma.movie.update({ where: { id }, data, select: { id: true } });
        return;
      case 'episode':
        await prisma.episode.update({ where: { id }, data, select: { id: true } });
        return;
      case 'reel':
        await prisma.reel.update({ where: { id }, data, select: { id: true } });
    }
  },

  async setHls(type: 'movie' | 'episode', id: string, out: HlsOutput) {
    const data = {
      videoStatus: 'READY' as const,
      videoProgress: 100,
      videoError: null,
      hlsPath: out.hlsPath,
      hlsKeyEnc: out.hlsKeyEnc,
      renditions: out.renditions,
      ...(out.durationSec ? { durationSec: out.durationSec } : {}),
    };
    if (type === 'movie') await prisma.movie.update({ where: { id }, data, select: { id: true } });
    else await prisma.episode.update({ where: { id }, data, select: { id: true } });
  },

  async setReel(id: string, out: ReelOutput) {
    await prisma.reel.update({ where: { id }, data: { ...out, videoStatus: 'READY', videoProgress: 100, videoError: null }, select: { id: true } });
  },
};
