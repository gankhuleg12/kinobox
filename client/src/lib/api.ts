/**
 * API client.
 *  - Access token зөвхөн санах ойд (XSS-ээр localStorage-оос хулгайлагдахгүй)
 *  - Refresh token httpOnly cookie-д (JS хандах боломжгүй)
 *  - Access token дуусахад нэг л удаа refresh хийнэ (single-flight), дараа нь хүсэлтийг давтана
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Listener = (token: string | null, data?: unknown) => void;

let accessToken: string | null = null;
let refreshing: Promise<unknown> | null = null;
const onToken = new Set<Listener>();
let onRevoked: ((message: string) => void) | null = null;

export const tokenStore = {
  get: () => accessToken,
  set(token: string | null, data?: unknown) {
    accessToken = token;
    for (const l of onToken) l(token, data);
  },
  subscribe(l: Listener) {
    onToken.add(l);
    return () => onToken.delete(l);
  },
  onSessionRevoked(fn: (message: string) => void) {
    onRevoked = fn;
  },
};

const baseHeaders = { Accept: 'application/json', 'X-KB-Client': 'web' };

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code: string; message: string; details?: unknown } };
    if (body.error) return new ApiError(res.status, body.error.code, body.error.message, body.error.details);
  } catch {
    /* ignore */
  }
  return new ApiError(res.status, 'HTTP_ERROR', res.statusText || 'Network error');
}

/** Cookie дахь refresh token-оор шинэ access token авна. Зэрэг дуудлагуудыг нэгтгэнэ. */
export function refreshSession<T = unknown>(): Promise<T | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include', headers: baseHeaders });
      if (!res.ok) {
        const err = await parseError(res);
        tokenStore.set(null);
        if (err.code === 'SESSION_REVOKED') onRevoked?.(err.message);
        return null;
      }
      const data = (await res.json()) as { accessToken: string };
      tokenStore.set(data.accessToken, data);
      return data;
    } catch {
      return null;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing as Promise<T | null>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  keepalive?: boolean;
}

export async function api<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const url = new URL(`${BASE}/api${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const isForm = opts.body instanceof FormData;
  const headers: Record<string, string> = { ...baseHeaders };
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    credentials: 'include',
    signal: opts.signal,
    keepalive: opts.keepalive,
    body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
  });

  if (res.status === 401 && !retried) {
    const err = await parseError(res);
    if (err.code === 'TOKEN_EXPIRED' || (err.code === 'UNAUTHORIZED' && accessToken === null)) {
      const refreshed = await refreshSession();
      if (refreshed) return api<T>(path, opts, true);
    }
    if (err.code === 'SESSION_REVOKED') {
      tokenStore.set(null);
      onRevoked?.(err.message);
    }
    throw err;
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiUrl = (path: string) => `${BASE}${path}`;
