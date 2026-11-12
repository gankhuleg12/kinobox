import { Queue } from 'bullmq';
import { createBullConnection } from './redis.js';

/**
 * BullMQ queue-ууд. API процесс зөвхөн job нэмнэ, worker процесс (src/worker.ts) боловсруулна.
 * Ингэснээр ffmpeg зэрэг хүнд ажил API-ийн хурдад нөлөөлөхгүй, тусад нь scale хийгдэнэ.
 */
export const QUEUES = {
  transcode: 'transcode',
  facebook: 'facebook',
  maintenance: 'maintenance',
} as const;

export interface TranscodeJob {
  type: 'movie' | 'episode' | 'reel';
  id: string;
  sourceKey: string;
}

export interface FacebookJob {
  kind: 'COMMENT' | 'MESSAGE';
  externalId: string;
  postId?: string;
  senderId: string;
  senderName?: string;
  text: string;
}

const connection = createBullConnection('queue-producer');

export const transcodeQueue = new Queue<TranscodeJob>(QUEUES.transcode, {
  connection,
  defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 100, removeOnFail: 500 },
});

export const facebookQueue = new Queue<FacebookJob>(QUEUES.facebook, {
  connection,
  defaultJobOptions: { attempts: 4, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 1000 },
});

export const maintenanceQueue = new Queue(QUEUES.maintenance, {
  connection,
  defaultJobOptions: { removeOnComplete: 50, removeOnFail: 100 },
});

export const WORKER_HEARTBEAT_KEY = 'worker:heartbeat';

/** BullMQ custom jobId-д ':' хориотой */
export const safeJobId = (...parts: string[]) => parts.join('-').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 200);
