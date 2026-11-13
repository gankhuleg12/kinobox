import { z } from 'zod';

/**
 * Зөвхөн дэд бүтцийн (infrastructure) тохиргоо env-ээс уншигдана.
 * R2, Wire.mn, Google, Facebook, SMTP зэрэг 3rd-party тохиргоонууд
 * Admin Panel-ээс удирдагдаж, database-д шифрлэгдэн хадгалагдана.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.url().default('http://localhost:5173'),
  API_URL: z.url().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  TRUST_PROXY: z.string().default('1'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET хамгийн багадаа 32 тэмдэгт'),
  JWT_PLAYBACK_SECRET: z.string().min(32, 'JWT_PLAYBACK_SECRET хамгийн багадаа 32 тэмдэгт'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET хамгийн багадаа 32 тэмдэгт'),
  /** base64 encoded 32 byte key — `openssl rand -base64 32` */
  SETTINGS_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'SETTINGS_ENCRYPTION_KEY нь base64 32 byte байх ёстой'),

  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
  PLAYBACK_TOKEN_TTL_SEC: z.coerce.number().int().default(6 * 3600),

  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  TRANSCODE_TMP_DIR: z.string().optional(),
  TRANSCODE_CONCURRENCY: z.coerce.number().int().min(1).default(1),
  /** true: background worker-ийг API процесс дотор ажиллуулна (тусдаа worker service-гүй туршилтын орчин) */
  RUN_WORKER: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Build хийсэн frontend-ийн хавтас: тохируулбал API нь сайтыг өөрөө (нэг домэйноос) үйлчилнэ */
  CLIENT_DIST_DIR: z.string().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

// Render.com: үйлчилгээний public URL-ийг автоматаар өгдөг тул тусад нь тохируулах шаардлагагүй
const source: NodeJS.ProcessEnv = { ...process.env };
if (source.RENDER_EXTERNAL_URL) {
  source.APP_URL ||= source.RENDER_EXTERNAL_URL;
  source.API_URL ||= source.RENDER_EXTERNAL_URL;
  source.CORS_ORIGINS ||= source.RENDER_EXTERNAL_URL;
}

const parsed = schema.safeParse(source);
if (!parsed.success) {
  console.error('❌ Env тохиргоо буруу байна:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  isDev: parsed.data.NODE_ENV === 'development',
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  appUrl: parsed.data.APP_URL.replace(/\/+$/, ''),
  apiUrl: parsed.data.API_URL.replace(/\/+$/, ''),
};

export type Env = typeof env;
