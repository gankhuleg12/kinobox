import { describe, it, expect } from 'vitest';
import { selectLadder, buildHlsArgs, buildReelArgs, parseProbe, REEL_MAX_SECONDS } from './ffmpeg.js';

describe('selectLadder', () => {
  it('never upscales', () => {
    expect(selectLadder(720).map((r) => r.name)).toEqual(['720p', '480p', '360p']);
    expect(selectLadder(2160).map((r) => r.name)).toEqual(['1080p', '720p', '480p', '360p']);
  });
  it('keeps lowest rendition for tiny sources', () => {
    expect(selectLadder(240).map((r) => r.name)).toEqual(['360p']);
  });
});

describe('buildHlsArgs', () => {
  const ladder = selectLadder(1080).slice(0, 2);
  it('builds encrypted multi-variant HLS command', () => {
    const args = buildHlsArgs({ input: '/in.mp4', outDir: '/out', ladder, hasAudio: true, keyInfoPath: '/k.info' });
    expect(args).toContain('-hls_key_info_file');
    expect(args[args.indexOf('-var_stream_map') + 1]).toBe('v:0,a:0,name:1080p v:1,a:1,name:720p');
    expect(args.at(-1)).toBe('/out/%v/index.m3u8');
  });
  it('omits audio mapping when source has no audio', () => {
    const args = buildHlsArgs({ input: '/in.mp4', outDir: '/out', ladder, hasAudio: false, keyInfoPath: '/k.info' });
    expect(args).not.toContain('0:a:0');
    expect(args[args.indexOf('-var_stream_map') + 1]).toBe('v:0,name:1080p v:1,name:720p');
  });
});

describe('buildReelArgs', () => {
  it('produces a capped, faststart, even-dimension MP4', () => {
    const args = buildReelArgs({ input: '/in.mov', output: '/out.mp4', hasAudio: true });
    expect(args[args.indexOf('-t') + 1]).toBe(String(REEL_MAX_SECONDS));
    expect(args[args.indexOf('-movflags') + 1]).toBe('+faststart');
    expect(args[args.indexOf('-vf') + 1]).toContain('trunc(iw/2)*2');
    expect(args).toContain('aac');
    expect(args.at(-1)).toBe('/out.mp4');
  });
  it('drops audio when source has none', () => {
    const args = buildReelArgs({ input: '/in.mov', output: '/out.mp4', hasAudio: false });
    expect(args).toContain('-an');
    expect(args).not.toContain('aac');
  });
});

describe('parseProbe', () => {
  it('reads dimensions, duration, audio', () => {
    const r = parseProbe(
      JSON.stringify({ streams: [{ codec_type: 'video', width: 1920, height: 800 }, { codec_type: 'audio' }], format: { duration: '5400.4' } }),
    );
    expect(r).toEqual({ width: 1920, height: 800, durationSec: 5400, hasAudio: true });
  });
});
