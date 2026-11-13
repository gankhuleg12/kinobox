import { hmacSha256 } from '../../lib/crypto.js';
import { settings } from '../settings/settings.service.js';

/**
 * Facebook Graph API client. Хүсэлт бүрт `appsecret_proof` хавсаргана —
 * токен алдагдсан ч App Secret-гүйгээр ашиглах боломжгүй болгоно.
 */
export class GraphError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly fbCode?: number,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

async function creds() {
  const s = await settings.require(['facebook.pageId', 'facebook.pageAccessToken', 'facebook.appSecret'], 'Facebook');
  const version = (await settings.get('facebook.graphVersion')) || 'v21.0';
  return { ...s, version };
}

async function graph<T = unknown>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const c = await creds();
  const url = new URL(`https://graph.facebook.com/${c.version}/${path.replace(/^\//, '')}`);
  url.searchParams.set('access_token', c['facebook.pageAccessToken']);
  url.searchParams.set('appsecret_proof', hmacSha256(c['facebook.appSecret'], c['facebook.pageAccessToken']));

  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } } & T;
  if (!res.ok || json.error) {
    throw new GraphError(json.error?.message ?? `Graph API ${res.status}`, res.status, json.error?.code);
  }
  return json;
}

export type Recipient = { id: string } | { comment_id: string };

export const graphClient = {
  async pageId() {
    return (await creds())['facebook.pageId'];
  },

  /** Messenger мессеж. comment_id recipient нь "Private Reply" (comment бүрт 1 удаа) */
  async sendMessage(recipient: Recipient, message: unknown) {
    const pageId = await this.pageId();
    const body: Record<string, unknown> = { recipient, message };
    if ('id' in recipient) body.messaging_type = 'RESPONSE';
    return graph<{ message_id?: string }>('POST', `${pageId}/messages`, body);
  },

  async replyToComment(commentId: string, message: string) {
    return graph('POST', `${encodeURIComponent(commentId)}/comments`, { message });
  },

  async healthCheck() {
    const pageId = await this.pageId();
    return graph<{ id: string; name: string }>('GET', `${pageId}?fields=id,name`);
  },

  /** Page-д ямар app-ууд, ямар field-ээр subscribe хийгдсэн */
  async subscribedApps() {
    const pageId = await this.pageId();
    return graph<{ data: { id: string; name?: string; subscribed_fields?: string[] }[] }>('GET', `${pageId}/subscribed_apps`);
  },

  /**
   * Page-ийг энэ app-д subscribe хийнэ — үүнгүйгээр App Dashboard дээр webhook тохируулсан ч
   * тухайн page-ийн comment/мессеж ирэхгүй (хамгийн түгээмэл алдаа). pages_manage_metadata эрх шаардлагатай.
   */
  async subscribePage(fields: string[]) {
    const pageId = await this.pageId();
    return graph<{ success?: boolean }>('POST', `${pageId}/subscribed_apps`, { subscribed_fields: fields.join(',') });
  },

  /** Page token-ий төрөл, эрхүүд (scopes), хугацаа — App ID тохируулсан үед */
  async debugToken() {
    const c = await creds();
    const appId = await settings.get('facebook.appId');
    if (!appId) return null;
    const url = new URL(`https://graph.facebook.com/${c.version}/debug_token`);
    url.searchParams.set('input_token', c['facebook.pageAccessToken']);
    url.searchParams.set('access_token', `${appId}|${c['facebook.appSecret']}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const json = (await res.json().catch(() => ({}))) as {
      data?: { app_id?: string; type?: string; is_valid?: boolean; scopes?: string[]; expires_at?: number; profile_id?: string; error?: { message?: string } };
      error?: { message?: string; code?: number };
    };
    if (!res.ok || json.error) throw new GraphError(json.error?.message ?? `debug_token ${res.status}`, res.status, json.error?.code);
    return json.data ?? null;
  },
};
