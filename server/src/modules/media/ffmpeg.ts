import { spawn } from 'node:child_process';

/** Adaptive bitrate шат — эх видеоны өндрөөс их чанарыг үүсгэхгүй */
export interface Rendition {
  name: string;
  height: number;
  vBitrate: number;
  maxrate: number;
  bufsize: number;
  aBitrate: number;
}

export const LADDER: Rendition[] = [
  { name: '1080p', height: 1080, vBitrate: 5000, maxrate: 5350, bufsize: 7500, aBitrate: 128 },
  { name: '720p', height: 720, vBitrate: 2800, maxrate: 2996, bufsize: 4200, aBitrate: 128 },
  { name: '480p', height: 480, vBitrate: 1400, maxrate: 1498, bufsize: 2100, aBitrate: 96 },
  { name: '360p', height: 360, vBitrate: 800, maxrate: 856, bufsize: 1200, aBitrate: 96 },
];

export function selectLadder(sourceHeight: number): Rendition[] {
  const picked = LADDER.filter((r) => r.height <= sourceHeight + 16);
  return picked.length ? picked : [LADDER[LADDER.length - 1]!];
}

export const SEGMENT_SECONDS = 6;

/**
 * Нэг ffmpeg процессоор бүх чанарыг зэрэг кодлоно (decode нэг удаа → хурдан).
 * Аргументыг массиваар дамжуулна — shell ашиглахгүй тул command injection боломжгүй.
 */
export function buildHlsArgs(opts: { input: string; outDir: string; ladder: Rendition[]; hasAudio: boolean; keyInfoPath: string }): string[] {
  const { input, outDir, ladder, hasAudio, keyInfoPath } = opts;
  const n = ladder.length;
  const split = `[0:v]split=${n}${ladder.map((_, i) => `[v${i}]`).join('')}`;
  const scales = ladder.map((r, i) => `[v${i}]scale=-2:${r.height}:flags=lanczos[v${i}o]`);
  const args = ['-hide_banner', '-nostats', '-y', '-i', input, '-filter_complex', [split, ...scales].join(';')];

  ladder.forEach((r, i) => {
    args.push('-map', `[v${i}o]`, `-c:v:${i}`, 'libx264', `-b:v:${i}`, `${r.vBitrate}k`, `-maxrate:v:${i}`, `${r.maxrate}k`, `-bufsize:v:${i}`, `${r.bufsize}k`);
  });
  if (hasAudio) {
    ladder.forEach((r, i) => {
      args.push('-map', '0:a:0', `-c:a:${i}`, 'aac', `-b:a:${i}`, `${r.aBitrate}k`, `-ac:a:${i}`, '2');
    });
  }

  args.push(
    '-preset', 'veryfast',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-sc_threshold', '0',
    '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
    '-f', 'hls',
    '-hls_time', String(SEGMENT_SECONDS),
    '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments',
    '-hls_key_info_file', keyInfoPath,
    '-hls_segment_filename', `${outDir}/%v/seg_%05d.ts`,
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', ladder.map((r, i) => (hasAudio ? `v:${i},a:${i},name:${r.name}` : `v:${i},name:${r.name}`)).join(' '),
    '-progress', 'pipe:1',
    `${outDir}/%v/index.m3u8`,
  );
  return args;
}

export const REEL_MAX_SECONDS = 180;

/**
 * Reel: CDN-ээс шууд тоглох нэг MP4 (H.264, 720x1280 хүрээнд, faststart).
 * Богино видеонд HLS-ээс илүү хурдан эхэлнэ (нэг HTTP хүсэлт, progressive).
 */
export function buildReelArgs(opts: { input: string; output: string; hasAudio: boolean }): string[] {
  return [
    '-hide_banner', '-nostats', '-y',
    '-i', opts.input,
    '-t', String(REEL_MAX_SECONDS),
    '-vf', "scale='min(720,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2",
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-crf', '23',
    '-maxrate', '2500k', '-bufsize', '5000k', '-pix_fmt', 'yuv420p',
    ...(opts.hasAudio ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : ['-an']),
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    opts.output,
  ];
}

/** Видеоны нэг кадрыг зураг болгон гаргах (reel poster) */
export function buildThumbnailArgs(input: string, output: string, atSec: number): string[] {
  return ['-hide_banner', '-y', '-ss', atSec.toFixed(2), '-i', input, '-frames:v', '1', '-q:v', '3', output];
}

export interface ProbeResult {
  width: number;
  height: number;
  durationSec: number;
  hasAudio: boolean;
}

export function parseProbe(json: string): ProbeResult {
  const data = JSON.parse(json) as { streams?: { codec_type?: string; width?: number; height?: number }[]; format?: { duration?: string } };
  const video = data.streams?.find((s) => s.codec_type === 'video');
  if (!video?.width || !video.height) throw new Error('Видео stream олдсонгүй');
  return {
    width: video.width,
    height: video.height,
    durationSec: Math.round(Number(data.format?.duration ?? 0)),
    hasAudio: Boolean(data.streams?.some((s) => s.codec_type === 'audio')),
  };
}

export function run(bin: string, args: string[], onStdout?: (chunk: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      if (onStdout) onStdout(s);
      else out += s;
    });
    child.stderr.on('data', (d: Buffer) => {
      err = (err + d.toString()).slice(-4000);
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${bin} exited ${code}: ${err.slice(-500)}`))));
  });
}
