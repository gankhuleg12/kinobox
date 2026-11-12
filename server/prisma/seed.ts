/**
 * Анхны өгөгдөл: admin хэрэглэгч, ангилал, сарын багц, (сонголтоор) жишээ кино.
 *   ADMIN_EMAIL, ADMIN_PASSWORD  — заавал
 *   SEED_SAMPLE_MOVIES=true      — жишээ кино нэмэх
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error('ADMIN_EMAIL болон ADMIN_PASSWORD (12+ тэмдэгт) env тохируулна уу');
  }

  await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: 'Administrator',
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
      passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
    },
    update: { role: 'ADMIN' },
  });
  console.log(`✔ Admin: ${email}`);

  const categories = [
    ['action', 'Тулаант', 'Action'],
    ['drama', 'Драм', 'Drama'],
    ['comedy', 'Инээдмийн', 'Comedy'],
    ['thriller', 'Триллер', 'Thriller'],
    ['sci-fi', 'Шинжлэх ухааны уран зөгнөлт', 'Sci-Fi'],
    ['animation', 'Хүүхэлдэйн', 'Animation'],
    ['mongolian', 'Монгол кино', 'Mongolian'],
    ['documentary', 'Баримтат', 'Documentary'],
  ] as const;
  for (const [i, [slug, nameMn, nameEn]] of categories.entries()) {
    await prisma.category.upsert({ where: { slug }, create: { slug, nameMn, nameEn, sortOrder: i }, update: {} });
  }
  console.log(`✔ ${categories.length} ангилал`);

  await prisma.plan.upsert({
    where: { code: 'monthly' },
    create: {
      code: 'monthly',
      nameMn: 'Сарын багц',
      nameEn: 'Monthly plan',
      descriptionMn: 'Бүх киног 30 хоног хязгааргүй үзнэ',
      descriptionEn: 'Unlimited access to all movies for 30 days',
      price: 15_000,
      durationDays: 30,
      isDefault: true,
    },
    update: {},
  });
  console.log('✔ Сарын багц');

  if (process.env.NODE_ENV !== 'production') {
    await prisma.setting.upsert({ where: { key: 'payment.provider' }, create: { key: 'payment.provider', value: 'mock' }, update: {} });
    console.log('✔ DEV: payment.provider = mock');
  }

  if (process.env.SEED_SAMPLE_MOVIES === 'true') {
    const cats = await prisma.category.findMany();
    const bySlug = new Map(cats.map((c) => [c.slug, c.id]));
    const samples = [
      { slug: 'steppe-horizon', title: 'Талын тэнгэрийн хаяа', titleEn: 'Steppe Horizon', year: 2025, cats: ['drama', 'mongolian'], code: '1', featured: true },
      { slug: 'night-runner', title: 'Шөнийн гүйгч', titleEn: 'Night Runner', year: 2024, cats: ['action', 'thriller'], code: '2', featured: true },
      { slug: 'orbit-zero', title: 'Тойрог зам Тэг', titleEn: 'Orbit Zero', year: 2025, cats: ['sci-fi'], code: '3', featured: false },
      { slug: 'laugh-track', title: 'Инээдний зам', titleEn: 'Laugh Track', year: 2023, cats: ['comedy'], code: '4', featured: false },
      { slug: 'little-ger', title: 'Бяцхан гэр', titleEn: 'Little Ger', year: 2024, cats: ['animation', 'mongolian'], code: '5', featured: false },
      { slug: 'blue-silk', title: 'Хөх торго', titleEn: 'Blue Silk', year: 2022, cats: ['documentary', 'mongolian'], code: '6', featured: false },
    ];
    for (const s of samples) {
      await prisma.movie.upsert({
        where: { slug: s.slug },
        create: {
          slug: s.slug,
          title: s.title,
          titleEn: s.titleEn,
          description: `${s.title} — жишээ тайлбар. Admin Panel-ээс постер, видео болон дэлгэрэнгүй мэдээллээ оруулна уу.`,
          releaseYear: s.year,
          durationSec: 5400 + Math.floor(Math.random() * 3600),
          ageRating: '13+',
          status: 'PUBLISHED',
          publishedAt: new Date(),
          isFeatured: s.featured,
          fbCode: s.code,
          categories: { create: s.cats.flatMap((c) => (bySlug.has(c) ? [{ categoryId: bySlug.get(c)! }] : [])) },
        },
        update: {},
      });
    }
    console.log(`✔ ${samples.length} жишээ кино`);

    // Жишээ цуврал: 6 анги, эхний 2 нь үнэгүй
    const series = await prisma.movie.upsert({
      where: { slug: 'steppe-legends' },
      create: {
        slug: 'steppe-legends',
        kind: 'SERIES',
        freeEpisodes: 2,
        title: 'Талын домог',
        titleEn: 'Steppe Legends',
        description: 'Талын домог — жишээ цуврал. Анги бүрийн видеог Admin Panel → Кино → Ангиуд хэсгээс upload хийнэ.',
        releaseYear: 2025,
        ageRating: '13+',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        isFeatured: true,
        fbCode: '7',
        categories: { create: [bySlug.get('drama'), bySlug.get('mongolian')].flatMap((id) => (id ? [{ categoryId: id }] : [])) },
      },
      update: {},
    });
    for (let n = 1; n <= 6; n++) {
      await prisma.episode.upsert({
        where: { movieId_seasonNumber_episodeNumber: { movieId: series.id, seasonNumber: 1, episodeNumber: n } },
        create: { movieId: series.id, seasonNumber: 1, episodeNumber: n, title: `${n}-р анги`, durationSec: 2400 + n * 60 },
        update: {},
      });
    }
    console.log('✔ Жишээ цуврал (6 анги, 2 үнэгүй)');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
