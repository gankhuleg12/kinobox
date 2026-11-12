import { prisma } from '../../lib/prisma.js';
import { redis, createSubscriber } from '../../lib/redis.js';
import { encrypt, decrypt, maskSecret } from '../../lib/crypto.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { AppError } from '../../lib/errors.js';
import {
  SETTINGS,
  SETTING_GROUPS,
  type SettingDef,
  type SettingGroup,
  type SettingKey,
  type SettingValue,
  getDef,
  isSettingKey,
} from './settings.registry.js';

const encKey = Buffer.from(env.SETTINGS_ENCRYPTION_KEY, 'base64');
const CHANNEL = 'settings:invalidate';
const LOCAL_TTL_MS = 60_000;

let snapshot: Map<string, string> | null = null;
let snapshotAt = 0;
let loading: Promise<Map<string, string>> | null = null;
const listeners = new Set<() => void>();

async function load(): Promise<Map<string, string>> {
  const rows = await prisma.setting.findMany();
  const map = new Map<string, string>();
  for (const row of rows) {
    try {
      map.set(row.key, row.isSecret ? decrypt(row.value, encKey) : row.value);
    } catch (err) {
      logger.error({ err, key: row.key }, 'Failed to decrypt setting — SETTINGS_ENCRYPTION_KEY өөрчлөгдсөн байж магадгүй');
    }
  }
  return map;
}

async function getSnapshot(): Promise<Map<string, string>> {
  if (snapshot && Date.now() - snapshotAt < LOCAL_TTL_MS) return snapshot;
  loading ??= load()
    .then((m) => {
      snapshot = m;
      snapshotAt = Date.now();
      return m;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

function coerce(def: SettingDef, raw: string | undefined): string | number | boolean {
  const value = raw ?? (def.default !== undefined ? String(def.default) : '');
  switch (def.type) {
    case 'int':
      return Number.parseInt(value, 10) || 0;
    case 'bool':
      return value === 'true';
    default:
      return value;
  }
}

function invalidateLocal() {
  snapshot = null;
  for (const fn of listeners) fn();
}

/** Олон instance дээр тохиргоо шинэчлэгдэхэд бүгдийн local cache-ийг цэвэрлэнэ */
export function startSettingsSync() {
  const sub = createSubscriber('settings-sub');
  sub.subscribe(CHANNEL).catch((err) => logger.error({ err }, 'settings subscribe failed'));
  sub.on('message', () => invalidateLocal());
  return () => sub.quit();
}

export const settings = {
  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const snap = await getSnapshot();
    return coerce(getDef(key), snap.get(key)) as SettingValue<K>;
  },

  async getMany<K extends SettingKey>(keys: readonly K[]): Promise<{ [P in K]: SettingValue<P> }> {
    const snap = await getSnapshot();
    const out = {} as { [P in K]: SettingValue<P> };
    for (const k of keys) (out as Record<string, unknown>)[k] = coerce(getDef(k), snap.get(k));
    return out;
  },

  /** Шаардлагатай утгууд хоосон бол SERVICE_NOT_CONFIGURED алдаа шиднэ */
  async require<K extends SettingKey>(keys: readonly K[], serviceName: string) {
    const values = await this.getMany(keys);
    for (const k of keys) {
      const v = values[k];
      if (v === '' || v === undefined || v === null) throw AppError.notConfigured(serviceName);
    }
    return values;
  },

  /** Нэвтрээгүй хэрэглэгчид ил гаргаж болох тохиргоо */
  async publicConfig() {
    const snap = await getSnapshot();
    const out: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(SETTINGS) as [SettingKey, SettingDef][]) {
      if (def.public && !def.secret) out[key] = coerce(def, snap.get(key));
    }
    return out;
  },

  /** Admin UI-д зориулсан: secret утгыг хэзээ ч буцаахгүй, зөвхөн mask + isSet */
  async adminView() {
    const snap = await getSnapshot();
    return SETTING_GROUPS.map((group) => ({
      group,
      fields: (Object.entries(SETTINGS) as [SettingKey, SettingDef][])
        .filter(([, def]) => def.group === group)
        .map(([key, def]) => {
          const raw = snap.get(key);
          return {
            key,
            type: def.type,
            label: def.label,
            help: def.help ?? null,
            options: def.options ?? null,
            secret: Boolean(def.secret),
            isSet: raw !== undefined && raw !== '',
            value: def.secret ? null : coerce(def, raw),
            preview: def.secret && raw ? maskSecret(raw) : null,
          };
        }),
    }));
  },

  /**
   * Тохиргоо шинэчлэх. Secret талбарт хоосон string ирвэл "өөрчлөхгүй" гэж үзнэ.
   * `clear` массив дахь secret key-үүдийг устгана.
   */
  async update(values: Record<string, unknown>, clear: string[], actorId: string) {
    const changed: string[] = [];
    const ops = [];

    for (const [key, rawValue] of Object.entries(values)) {
      if (!isSettingKey(key)) throw AppError.badRequest(`Тодорхойгүй тохиргоо: ${key}`);
      const def = getDef(key);
      const value = validateValue(key, def, rawValue);
      if (value === null) continue; // secret, unchanged
      ops.push(
        prisma.setting.upsert({
          where: { key },
          create: { key, value: def.secret ? encrypt(value, encKey) : value, isSecret: Boolean(def.secret), updatedById: actorId },
          update: { value: def.secret ? encrypt(value, encKey) : value, isSecret: Boolean(def.secret), updatedById: actorId },
        }),
      );
      changed.push(key);
    }

    for (const key of clear) {
      if (!isSettingKey(key)) throw AppError.badRequest(`Тодорхойгүй тохиргоо: ${key}`);
      ops.push(prisma.setting.deleteMany({ where: { key } }));
      changed.push(key);
    }

    if (ops.length) {
      await prisma.$transaction(ops);
      invalidateLocal();
      await redis.publish(CHANNEL, String(Date.now()));
    }
    return changed;
  },

  groupOf(key: SettingKey): SettingGroup {
    return getDef(key).group;
  },

  onChange(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

function validateValue(key: string, def: SettingDef, raw: unknown): string | null {
  if (def.type === 'bool') {
    if (typeof raw !== 'boolean') throw AppError.badRequest(`${key}: boolean утга шаардлагатай`);
    return String(raw);
  }
  if (def.type === 'int') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n)) throw AppError.badRequest(`${key}: бүхэл тоо шаардлагатай`);
    if (def.min !== undefined && n < def.min) throw AppError.badRequest(`${key}: хамгийн багадаа ${def.min}`);
    if (def.max !== undefined && n > def.max) throw AppError.badRequest(`${key}: хамгийн ихдээ ${def.max}`);
    return String(n);
  }
  if (typeof raw !== 'string') throw AppError.badRequest(`${key}: текст утга шаардлагатай`);
  // eslint-disable-next-line no-control-regex
  const value = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (def.secret && value === '') return null;
  if (value.length > (def.type === 'text' ? 4000 : 2000)) throw AppError.badRequest(`${key}: хэт урт байна`);
  if (def.type === 'select' && def.options && !def.options.includes(value)) {
    throw AppError.badRequest(`${key}: зөвшөөрөгдөх утга ${def.options.join(', ')}`);
  }
  if (def.type === 'url' && value !== '') {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
    } catch {
      throw AppError.badRequest(`${key}: URL буруу байна`);
    }
    return value.replace(/\/+$/, '');
  }
  return value;
}
