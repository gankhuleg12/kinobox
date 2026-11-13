/**
 * Нэг MySQL-ээс нөгөө рүү өгөгдөл хуулах (жишээ нь локал WAMP → Aiven).
 *
 * Яагаад mysqldump биш вэ: Windows MySQL хүснэгтийн нэрийг жижиг үсгээр (`movie`) хадгалдаг
 * бол Linux MySQL том жижиг үсэг ялгадаг (`Movie`) тул dump шууд импортлогдохгүй.
 * Prisma-аар дамжуулбал нэр, төрлийг зөв хөрвүүлнэ.
 *
 * Хэрэглээ (PowerShell):
 *   $env:SOURCE_DATABASE_URL="mysql://kinobox:...@127.0.0.1:3306/kinobox"
 *   $env:TARGET_DATABASE_URL="mysql://avnadmin:...@HOST:PORT/defaultdb?sslaccept=accept_invalid_certs"
 *   $env:DATABASE_URL=$env:TARGET_DATABASE_URL; npx prisma migrate deploy   # хүснэгт үүсгэх
 *   npx tsx prisma/copy-db.ts
 *
 * ⚠️ Admin-д хадгалсан API key-үүд шифрлэгдсэн тул Render дээр SETTINGS_ENCRYPTION_KEY
 *    нь локал server/.env-тэй ИЖИЛ байх ёстой. Session-ууд хуулагдахгүй (дахин нэвтэрнэ).
 */
import { Prisma, PrismaClient } from '@prisma/client';

const sourceUrl = process.env.SOURCE_DATABASE_URL;
const targetUrl = process.env.TARGET_DATABASE_URL;
if (!sourceUrl || !targetUrl) throw new Error('SOURCE_DATABASE_URL болон TARGET_DATABASE_URL тохируулна уу');
if (sourceUrl === targetUrl) throw new Error('Эх ба зорилтот DB ижил байна');

const from = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
const to = new PrismaClient({ datasources: { db: { url: targetUrl } } });

type Delegate = { findMany: () => Promise<Record<string, unknown>[]>; createMany: (args: { data: unknown[]; skipDuplicates: boolean }) => Promise<{ count: number }> };

// Foreign key-ийн дарааллаар. Json талбарын null-ийг Prisma.DbNull болгох шаардлагатай.
const MODELS: { name: string; json?: string[] }[] = [
  { name: 'user' },
  { name: 'category' },
  { name: 'plan' },
  { name: 'movie', json: ['renditions'] },
  { name: 'movieCategory' },
  { name: 'episode', json: ['renditions'] },
  { name: 'reel' },
  { name: 'setting' },
  { name: 'payment', json: ['deeplinks'] },
  { name: 'rental' },
  { name: 'subscription' },
  { name: 'watchProgress' },
  { name: 'webhookEvent' },
  { name: 'fbBotEvent' },
  { name: 'auditLog', json: ['meta'] },
];

async function main() {
  for (const model of MODELS) {
    const src = (from as unknown as Record<string, Delegate>)[model.name]!;
    const dst = (to as unknown as Record<string, Delegate>)[model.name]!;
    const rows = await src.findMany();
    const data = rows.map((r) => {
      const copy = { ...r };
      for (const f of model.json ?? []) if (copy[f] === null) copy[f] = Prisma.DbNull;
      return copy;
    });
    let inserted = 0;
    for (let i = 0; i < data.length; i += 500) {
      inserted += (await dst.createMany({ data: data.slice(i, i + 500), skipDuplicates: true })).count;
    }
    console.log(`✔ ${model.name}: ${inserted}/${rows.length}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => Promise.all([from.$disconnect(), to.$disconnect()]));
