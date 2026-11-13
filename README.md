# KinoBox — Кино стрийминг платформ

React + Node.js + MySQL + Redis + Cloudflare R2. HLS adaptive стрийминг, Wire.mn төлбөр, Google нэвтрэлт, Facebook Messenger bot, бүрэн Admin Panel.

```
┌──────────────┐   /api    ┌──────────────┐        ┌───────┐
│ React (Vite) │ ────────▶ │ Express API  │ ─────▶ │ MySQL │
│  nginx       │           │  (stateless) │ ─────▶ │ Redis │◀─┐
└──────┬───────┘           └──────┬───────┘        └───────┘  │ BullMQ
       │ HLS segment (presigned)  │ presign / upload           │
       ▼                          ▼                    ┌──────────────┐
┌──────────────────────────────────────────┐          │ Worker       │
│ Cloudflare R2: media (private) · assets  │◀─────────│ ffmpeg, FB   │
└──────────────────────────────────────────┘          └──────────────┘
```

## Боломжууд

**Хэрэглэгч**
- Нүүр хуудас: featured carousel, шинэ кино, эрэлттэй, ангилал бүрийн мөр, үргэлжлүүлэн үзэх
- Ангилал, эрэмбэлэлт, infinite scroll; MySQL FULLTEXT хайлт (debounce)
- Киноны дэлгэрэнгүй, трейлер, төстэй кино; эрхээс хамаарсан CTA (үзэх / түрээслэх / багц)
- HLS тоглуулагч: 360p–1080p авто чанар, чанар сонгох, гарын товчлол, үзсэн байрлалаа санах
- **Олон ангит цуврал:** улирал/анги, **эхний N анги үнэгүй** (нэвтэрсэн хэрэглэгчид), сүүлд үзсэн ангиасаа үргэлжлүүлэх, дуусахад дараагийн анги руу автоматаар шилжих. Түрээс/багц нь бүх ангид хамаарна
- **Reels:** босоо богино видео feed (snap scroll, автоматаар тоглоно, дуу нэг товшилтоор), reel бүрээс холбогдох кино руу шууд орох, нүүр хуудсанд reels мөр, хуваалцах холбоос
- Багц, checkout (QR, банкны апп deeplink), төлбөрийн төлөв real-time шалгах
- Бүртгэл: нэр + email + нууц үг, Google OAuth, нууц үг сэргээх
- Dark / Light / System theme, Монгол / Англи хэл, responsive

**Admin Panel** (`/admin`)
- Хянах самбар: орлого, идэвхтэй багц, 30 хоногийн график
- Кино: CRUD, постер/backdrop upload (WebP олон хэмжээ), **60GB хүртэл видео browser-оос шууд R2 руу** (multipart), transcode явц
- Цуврал: "Олон ангит" төрөл, үнэгүй ангийн тоо, анги бүрийн зураг/видео/нийтлэх төлөв
- Reels: босоо видео upload (720p MP4 + poster автоматаар, CDN-ээс тоглоно), кинотой холбох, дараалал
- Ангилал, үнэ & багц, хэрэглэгч (эрх, хаах, session цуцлах, багц олгох), төлбөр (провайдерээс шалгах, буцаалт), subscription
- Facebook bot: киноны код, event log, тохируулах заавар
- API тохиргоо: R2, Wire.mn, Google, Facebook, SMTP — **холболт шалгах** товчтой
- Audit log

Эрх: `EDITOR` — кино, ангилал; `ADMIN` — бүгд.

## Аюулгүй байдал

| Сэдэв | Шийдэл |
|---|---|
| Нууц үг | Argon2id, нэвтрэх оролдлого 5 удаа алдвал 15 мин түгжинэ, user enumeration хамгаалалт |
| Session | Access JWT 15 мин (санах ойд), refresh token httpOnly cookie, **rotation + reuse detection** |
| Нэг төхөөрөмж | Шинэ нэвтрэлт бусад session-ыг шууд цуцална; Redis-ээр хүсэлт бүрт шалгана; тоглуулагч 30 сек тутам heartbeat-ээр зогсоно |
| CSRF | API нь Bearer token; cookie endpoint-ууд custom header шаардана (CORS preflight) |
| XSS | React escape, input-оос `<>` хасна, хатуу CSP (inline script hash-аар), `X-Frame-Options: DENY` |
| SQL injection | Prisma parameterized query; raw SQL зөвхөн tagged template |
| Validation | Бүх endpoint zod schema, тодорхойгүй талбар хасагдана (mass assignment) |
| Rate limit | Redis-д суурилсан, endpoint бүрт тусдаа (auth, register, checkout, playback, webhook…) |
| Secret | AES-256-GCM-ээр DB-д, API хэзээ ч буцаахгүй (зөвхөн `••••1234`), audit-д утга бичигдэхгүй |
| Видео | Private bucket, AES-128 HLS шифрлэлт, түлхүүр зөвхөн token + идэвхтэй session-тэй хэрэглэгчид |
| Webhook | HMAC-SHA256 + timestamp (replay), event_id давхардал, дүн/валют тулгалт, **провайдерын API-аар давхар шалгалт**, idempotent эрх олголт |
| Бусад | Helmet, HSTS, open-redirect хамгаалалт, OAuth state + PKCE + nonce, Facebook `appsecret_proof` |

## Хурд

- Route бүр тусдаа chunk, hls.js зөвхөн тоглуулах үед ачаалагдана
- Skeleton loading, `loading="lazy"` + `srcset` WebP, poster-ийн өнгөөр placeholder (layout shift үгүй)
- Мөрүүд дэлгэцэнд ойртох үед л зурагдана (IntersectionObserver)
- Redis cache (namespace version-оор O(1) invalidation), HTTP `Cache-Control` + ETag, stampede хамгаалалт
- DB index: нийтлэгдсэн огноо, үзэлт, хэрэглэгчийн эрх, төлбөрийн төлөв гэх мэт бүх query-д
- Видео сегментүүд R2/CDN-ээс шууд, сервер дундуур дамжихгүй

---

## Локал орчинд ажиллуулах

**Шаардлага:** Node.js 20.19+, MySQL 8, Redis 7, ffmpeg (worker-т)

```bash
# 1. Хамаарал
npm --prefix server install
npm --prefix client install

# 2. Тохиргоо
cp server/.env.example server/.env
#    SETTINGS_ENCRYPTION_KEY=$(openssl rand -base64 32) гэх мэтээр бөглөнө
#    Локалд API_URL=http://localhost:5173 (Vite proxy-оор нэг origin)

# 3. Database
npm --prefix server run db:deploy     # migration
npm --prefix server run db:seed       # admin + ангилал + сарын багц (+ жишээ кино)

# 4. Ажиллуулах (3 terminal)
npm --prefix server run dev           # API  → :4000
npm --prefix server run dev:worker    # ffmpeg / FB bot worker
npm --prefix client run dev           # Web  → http://localhost:5173
```

Development орчинд `payment.provider = mock` байх тул төлбөрийн хуудсанд **"DEV: Төлсөн гэж дуурайх"** товч гарч, бодит webhook-тэй яг ижил замаар (гарын үсэг шалгалттайгаар) эрх идэвхжинэ.

```bash
npm --prefix server test        # unit test (crypto, webhook signature, HLS, FB bot, ffmpeg)
npm --prefix server run typecheck
npm --prefix client run build
```

## Production (Docker)

```bash
cp .env.example .env            # бүх secret-ийг бөглөнө
docker compose up -d --build
docker compose run --rm api npm run db:seed
```

## Render.com дээр туршилтаар ажиллуулах

Root дахь [Dockerfile](Dockerfile) нь сайт + API + ffmpeg-ийг нэг image болгоно (API нь сайтыг өөрөө нэг домэйноос үйлчилнэ). [render.yaml](render.yaml) Blueprint нь web service + Key Value (Redis)-ийг үүсгэнэ.

1. **MySQL 8** (Render-д MySQL байхгүй): жишээ нь [Aiven](https://aiven.io) Developer план. Connection URI-ийн төгсгөлийн `?ssl-mode=REQUIRED`-г `?sslaccept=accept_invalid_certs` болгож Prisma-д тааруулна.
2. **Хүснэгт + өгөгдөл** (локал компьютероос):
   ```powershell
   cd server
   $env:DATABASE_URL="mysql://avnadmin:...@HOST:PORT/defaultdb?sslaccept=accept_invalid_certs"
   npx prisma migrate deploy
   # A) Шинээр: $env:NODE_ENV="production"; npm run db:seed
   # B) Локал өгөгдлөө хуулах: $env:SOURCE_DATABASE_URL="<локал>"; $env:TARGET_DATABASE_URL=$env:DATABASE_URL; npx tsx prisma/copy-db.ts
   ```
3. GitHub руу push хийгээд Render → **New → Blueprint** → repo-г сонгоно. `DATABASE_URL` болон `SETTINGS_ENCRYPTION_KEY`-г оруулна (B сонголтод `server/.env`-ийнхтэй **ижил** түлхүүр).
4. Deploy дууссаны дараа `https://<нэр>.onrender.com`-ийг дараах газруудад нэмнэ: Google Console (redirect URI `/api/auth/google/callback`), R2 bucket-уудын CORS, Admin → Wire.mn → "Webhook бүртгэх", Facebook webhook.
5. Admin нэвтэрч `/api/admin/stats/whoami`-г нээгээд `ip` нь өөрийн IP мөн эсэхийг шалгана (буруу бол `TRUST_PROXY`-г тааруулна).

**Free түвшний хязгаарлалт:** 15 мин хандалтгүй бол унтана (~1 мин сэргэнэ); Key Value санах ойд л хадгалагдана (restart-д queue алдагдана); CPU/RAM бага тул worker (`RUN_WORKER=true`) зөвхөн богино видео/reel-д тохиромжтой. Бүтэн кинонд Starter план + тусдаа worker service (render.yaml-д тайлбартай) хэрэглэнэ.

`web` (nginx) нь SPA болон `/api`-г нэг домэйнээр үйлчилнэ. Өмнө нь TLS terminate хийх proxy (Cloudflare, Caddy…) байрлуулна. Worker-ийг тусад нь олшруулж болно: `docker compose up -d --scale worker=3`.

> ⚠️ `SETTINGS_ENCRYPTION_KEY`-г алдвал DB дэх бүх API key-г тайлах боломжгүй. Аюулгүй газар нөөцлөөрэй.

---

## Admin Panel-ээс тохируулах

Нэвтэрсний дараа **Admin → API тохиргоо**.

### Cloudflare R2
1. Хоёр bucket үүсгэнэ: `kinobox-media` (**private**), `kinobox-assets` (public custom domain холбоно, ж: `cdn.kinobox.mn`)
2. R2 API Token (Object Read & Write) үүсгэж Account ID, Access Key, Secret-ийг оруулна
3. **Хоёр bucket-д CORS** тохируулна (видео upload-д `ETag` заавал):
   ```json
   [{
     "AllowedOrigins": ["http://localhost:5173"],
     "AllowedMethods": ["GET", "HEAD", "PUT"],
     "AllowedHeaders": ["*"],
     "ExposeHeaders": ["ETag"],
     "MaxAgeSeconds": 3600
   }]
   ```
4. "Холболт шалгах" дарна

### Wire.mn ([docs.wire.mn](https://docs.wire.mn))
1. [app.wire.mn](https://app.wire.mn) дээр баталгаажуулалт хийж, project үүсгээд connector болон settlement account холбоно.
2. Project-ийн **Secret key (`sk_live_…`)**-ийг Admin → API тохиргоо → Wire.mn-д оруулна. **Merchant ID шаардлагагүй** — түлхүүр нь project-оо тодорхойлно. `payment.provider = wire` болгоно.
3. **Төлбөрийн хуудас:** `hosted` (Wire-ийн хуудас дээр бүх банк/QR/апп сонгоно — санал болгох) эсвэл `qr` (манай хуудсанд QR шууд).
4. **Webhook (заавал биш):** "Webhook бүртгэх" товч нь Wire API-аар endpoint үүсгэж signing secret-ийг автоматаар шифрлэн хадгална. Дараа нь app.wire.mn дээр endpoint-ийг verify хийнэ. Wire нь localhost руу илгээдэггүй тул public домэйн хэрэгтэй.

**Callback-гүй үед:** Wire төлбөрийн төлвийг өөрөө шинэчилдэг. "Webhook ирээгүй үед провайдерын API-аас шалгах" тохиргоо (анхдагчаар асаалттай) идэвхтэй бол сервер `GET /v1/payment_intents/{id}`-ээр (browser биш, серверээс) төлөвийг шалгаж, `succeeded` болон дүн таарсан үед л эрх идэвхжүүлнэ — хэрэглэгч төлбөрийн хуудсанд байх үед 5 сек тутам, хаасан бол maintenance-ээр 2 мин тутам. Webhook тохируулсан бол шууд баталгаажна (гарын үсэг `WirePayment-Signature` HMAC-SHA256, 300 сек, `event.id`-аар давхардал шалгана).

Шинэ провайдер (QPay г.м.) нэмэх бол `PaymentProvider` interface-ийг хэрэгжүүлээд `providers/index.ts`-д бүртгэнэ.

### Google OAuth
Google Cloud Console → OAuth Client (Web). Authorized redirect URI-д `{API_URL}/api/auth/google/callback`. Client ID/Secret оруулаад "Google-ээр нэвтрэх"-ийг асаана.

### Facebook Messenger bot
1. Meta for Developers → App → **Messenger** + **Webhooks**, Page-ээ холбоно
2. Page ID, App Secret, Page Access Token, өөрийн сонгосон Verify Token-ийг оруулна
3. Webhook callback: `{API_URL}/api/webhooks/facebook`, field: `feed`, `messages`
4. Эрх: `pages_messaging`, `pages_read_engagement`, `pages_manage_engagement`
5. Кино бүрт код онооно (кино засах хуудас эсвэл Facebook bot хуудас)

Урсгал: пост дээр "1 гэж comment бичээрэй" → хэрэглэгч `1` гэж бичнэ → Messenger-ээр (Private Reply) зурагтай карт: киноны мэдээлэл, нэг киноны үнэ, сарын багцын үнэ, **"1 кино авах"**, **"Сарын багц авах"** товч → сайтын checkout руу шууд оруулна. Comment-д "Messenger-ээр илгээлээ" гэж олон нийтэд хариулж болно. Messenger-т шууд код бичсэн ч ажиллана. Мессежийн загвар, товчны нэрийг тохиргооноос өөрчилнө.

### SMTP
Нууц үг сэргээх имэйлд. Host, port, user, password, From.

---

## Төслийн бүтэц

```
server/
  prisma/              schema, migration, seed
  src/
    config/env.ts      env validation (zod)
    lib/               prisma, redis, cache, crypto, jwt, r2, queue, mailer
    middleware/        auth, validate, rateLimit, error
    modules/
      auth/            бүртгэл, нэвтрэлт, refresh rotation, Google OAuth, session store
      catalog/         нүүр, жагсаалт, хайлт, дэлгэрэнгүй (cache)
      access/          эрхийн шалгалт (багц/түрээс)
      playback/        HLS playlist rewrite, AES түлхүүр, heartbeat
      payments/        checkout, webhook, providers/ (wire, mock)
      facebook/        Graph API client, bot логик
      settings/        шифрлэгдсэн тохиргооны бүртгэл/service
      admin/           admin API-ууд
      media/           зураг (sharp), ffmpeg HLS
    jobs/              transcode, maintenance
    server.ts          API процесс
    worker.ts          background worker процесс
client/
  src/
    lib/               api client, auth store, queries, upload
    components/        ui, layout, movie, player
    pages/             хэрэглэгчийн хуудсууд, admin/
    i18n/              mn, en
```

## Тэмдэглэл

- Admin Panel-ийн интерфэйс зөвхөн Монгол хэлтэй; хэрэглэгчийн хэсэг Монгол/Англи.
- API stateless тул load balancer-ийн ард олон instance ажиллуулж болно (session, cache, rate limit, тохиргооны invalidation бүгд Redis-ээр).
- Redis заавал `maxmemory-policy noeviction` байна (BullMQ шаардлага).
