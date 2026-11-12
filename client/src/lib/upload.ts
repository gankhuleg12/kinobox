import { api } from './api';

/**
 * Том видео файлыг browser-оос шууд Cloudflare R2 руу multipart-аар upload хийнэ.
 * Сервер зөвхөн part бүрийн presigned URL олгоно → серверийн bandwidth/санах ой зарцуулахгүй.
 * Part бүр 3 удаа хүртэл дахин оролдоно; 4 part зэрэг илгээнэ.
 */
export interface UploadHandle {
  promise: Promise<void>;
  cancel: () => void;
}

function putPart(url: string, blob: Blob, onProgress: (loaded: number) => void, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      const etag = xhr.getResponseHeader('ETag');
      if (xhr.status >= 200 && xhr.status < 300 && etag) resolve(etag);
      else reject(new Error(etag ? `Upload failed (${xhr.status})` : 'ETag header уншигдсангүй — R2 CORS дээр ExposeHeaders: ["ETag"] тохируулна уу'));
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

/** basePath: жишээ нь /admin/movies/{id}/video, /admin/episodes/{id}/video, /admin/reels/{id}/video */
export function uploadVideo(basePath: string, file: File, onProgress: (pct: number) => void): UploadHandle {
  const controller = new AbortController();
  let uploadId: string | null = null;

  const promise = (async () => {
    const base = basePath;
    const init = await api<{ uploadId: string; key: string; partSize: number; partCount: number }>(`${base}/init`, {
      method: 'POST',
      body: { fileName: file.name, size: file.size, contentType: file.type || 'video/mp4' },
    });
    uploadId = init.uploadId;

    const loaded = new Map<number, number>();
    const report = () => onProgress(Math.min(99, Math.floor(([...loaded.values()].reduce((a, b) => a + b, 0) / file.size) * 100)));
    const pending = Array.from({ length: init.partCount }, (_, i) => i + 1);
    const done: { partNumber: number; etag: string }[] = [];

    const worker = async () => {
      while (pending.length) {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const batch = pending.splice(0, 4);
        const { urls } = await api<{ urls: { partNumber: number; url: string }[] }>(`${base}/sign`, {
          method: 'POST',
          body: { uploadId: init.uploadId, partNumbers: batch },
        });
        for (const { partNumber, url } of urls) {
          const start = (partNumber - 1) * init.partSize;
          const blob = file.slice(start, Math.min(start + init.partSize, file.size));
          for (let attempt = 1; ; attempt++) {
            try {
              const etag = await putPart(url, blob, (n) => (loaded.set(partNumber, n), report()), controller.signal);
              done.push({ partNumber, etag });
              loaded.set(partNumber, blob.size);
              report();
              break;
            } catch (err) {
              if (controller.signal.aborted || attempt >= 3) throw err;
              await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
          }
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(4, init.partCount) }, worker));
    await api(`${base}/complete`, { method: 'POST', body: { uploadId: init.uploadId, parts: done } });
    onProgress(100);
  })();

  return {
    promise,
    cancel() {
      controller.abort();
      if (uploadId) void api(`${basePath}/abort`, { method: 'POST', body: { uploadId } }).catch(() => undefined);
    },
  };
}
