/**
 * Admin Panel-ээс удирдах бүх тохиргооны бүртгэл.
 * Шинэ тохиргоо нэмэхдээ зөвхөн энд нэмэхэд хангалттай — UI автоматаар зурагдана.
 *
 * secret: true  → DB-д AES-256-GCM-ээр шифрлэгдэнэ, API-аар хэзээ ч буцаагдахгүй (зөвхөн mask).
 * public: true  → нэвтрээгүй frontend-д ил гаргаж болох (жишээ нь siteName).
 */
export type SettingType = 'string' | 'int' | 'bool' | 'text' | 'select' | 'url';

export interface SettingDef {
  group: SettingGroup;
  type: SettingType;
  label: string;
  help?: string;
  secret?: boolean;
  public?: boolean;
  default?: string | number | boolean;
  options?: string[];
  min?: number;
  max?: number;
}

export const SETTING_GROUPS = ['general', 'pricing', 'payment', 'wire', 'r2', 'google', 'facebook', 'smtp'] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export const SETTINGS = {
  // ── General
  'general.siteName': { group: 'general', type: 'string', label: 'Сайтын нэр', default: 'KinoBox', public: true },
  'general.supportEmail': { group: 'general', type: 'string', label: 'Тусламжийн email', default: '', public: true },
  'general.maintenanceMode': { group: 'general', type: 'bool', label: 'Засвар үйлчилгээний горим', default: false, public: true },

  // ── Pricing
  'pricing.defaultRentPrice': { group: 'pricing', type: 'int', label: 'Нэг кино түрээсийн үндсэн үнэ (₮)', default: 5000, min: 0, max: 10_000_000, public: true },
  'pricing.defaultRentHours': { group: 'pricing', type: 'int', label: 'Түрээсийн хугацаа (цаг)', default: 48, min: 1, max: 24 * 365, public: true },
  'pricing.monthlyPlanCode': { group: 'pricing', type: 'string', label: 'Үндсэн сарын багцын код', default: 'monthly', help: 'Facebook bot болон "Сарын багц авах" товч энэ багц руу оруулна' },

  // ── Payment
  'payment.provider': { group: 'payment', type: 'select', label: 'Төлбөрийн үйлчилгээ', default: 'wire', options: ['wire', 'mock'], help: '"mock" нь зөвхөн development орчинд ажиллана' },
  'payment.invoiceTtlMinutes': { group: 'payment', type: 'int', label: 'Нэхэмжлэхийн хүчинтэй хугацаа (минут)', default: 30, min: 5, max: 1440, help: 'Wire.mn өөрийн хугацааг (анхдагч 10 мин) буцаавал түүнийг ашиглана' },
  'payment.pollFallback': {
    group: 'payment',
    type: 'bool',
    label: 'Webhook ирээгүй үед провайдерын API-аас төлөв шалгах',
    default: true,
    help: 'Сервер өөрөө Wire.mn API-аас (browser биш) шалгаж баталгаажуулна. Callback тохируулаагүй ч төлбөр идэвхжинэ.',
  },

  // ── Wire.mn (https://docs.wire.mn)
  'wire.baseUrl': { group: 'wire', type: 'url', label: 'API Base URL', default: 'https://api.wire.mn' },
  'wire.apiKey': { group: 'wire', type: 'string', label: 'Secret key (sk_live_…)', secret: true, help: 'app.wire.mn → Project → API keys. Merchant ID шаардлагагүй: түлхүүр нь project-оо тодорхойлно.' },
  'wire.webhookSecret': {
    group: 'wire',
    type: 'string',
    label: 'Webhook signing secret (whsec_…)',
    secret: true,
    help: '"Webhook бүртгэх" товч автоматаар бөглөнө. Хоосон бол polling-оор ажиллана.',
  },
  'wire.checkoutMode': {
    group: 'wire',
    type: 'select',
    label: 'Төлбөрийн хуудас',
    default: 'hosted',
    options: ['hosted', 'qr'],
    help: 'hosted: Wire-ийн хуудас (бүх банк, QR, апп сонгоно) · qr: манай хуудсанд QR код шууд харуулна',
  },
  'wire.verifyViaApi': { group: 'wire', type: 'bool', label: 'Webhook ирэхэд API-аар давхар шалгах', default: true },

  // ── Cloudflare R2
  'r2.accountId': { group: 'r2', type: 'string', label: 'Account ID' },
  'r2.accessKeyId': { group: 'r2', type: 'string', label: 'Access Key ID', secret: true },
  'r2.secretAccessKey': { group: 'r2', type: 'string', label: 'Secret Access Key', secret: true },
  'r2.mediaBucket': { group: 'r2', type: 'string', label: 'Видео bucket (private)', default: 'kinobox-media' },
  'r2.assetsBucket': { group: 'r2', type: 'string', label: 'Зургийн bucket (public)', default: 'kinobox-assets' },
  'r2.assetsPublicUrl': { group: 'r2', type: 'url', label: 'Зургийн public URL (CDN домэйн)', help: 'жишээ: https://cdn.example.mn', public: true },
  'r2.segmentUrlTtlSec': { group: 'r2', type: 'int', label: 'Видео segment URL хүчинтэй хугацаа (сек)', default: 21600, min: 300, max: 604800 },

  // ── Google OAuth
  'google.enabled': { group: 'google', type: 'bool', label: 'Google-ээр нэвтрэх', default: true, public: true, help: 'Client ID, Secret хоёул тохируулагдсан үед товч харагдана' },
  'google.clientId': { group: 'google', type: 'string', label: 'Client ID' },
  'google.clientSecret': { group: 'google', type: 'string', label: 'Client Secret', secret: true },

  // ── Facebook Messenger bot
  'facebook.enabled': { group: 'facebook', type: 'bool', label: 'Messenger bot идэвхтэй', default: false },
  'facebook.pageId': { group: 'facebook', type: 'string', label: 'Page ID' },
  'facebook.appId': { group: 'facebook', type: 'string', label: 'App ID', help: 'Meta App Dashboard → App settings → Basic. Токены эрхийг шалгах оношилгоонд хэрэгтэй.' },
  'facebook.appSecret': { group: 'facebook', type: 'string', label: 'App Secret', secret: true },
  'facebook.pageAccessToken': { group: 'facebook', type: 'string', label: 'Page Access Token', secret: true },
  'facebook.verifyToken': { group: 'facebook', type: 'string', label: 'Webhook Verify Token', secret: true },
  'facebook.graphVersion': { group: 'facebook', type: 'string', label: 'Graph API хувилбар', default: 'v21.0' },
  'facebook.templateStyle': { group: 'facebook', type: 'select', label: 'Мессежийн хэлбэр', default: 'generic', options: ['generic', 'button'], help: 'generic: зурагтай карт, button: урт тайлбартай текст' },
  'facebook.messageTemplate': {
    group: 'facebook',
    type: 'text',
    label: 'Мессежийн загвар',
    default: '🎬 {title} ({year})\n{description}\n\n🎟 1 кино: {rentPrice}₮ / {rentHours} цаг\n⭐ {planName}: {planPrice}₮',
    help: 'Хувьсагч: {title} {year} {description} {rentPrice} {rentHours} {planName} {planPrice} {url}',
  },
  'facebook.rentButtonLabel': { group: 'facebook', type: 'string', label: '"1 кино авах" товчны нэр', default: '1 кино авах' },
  'facebook.planButtonLabel': { group: 'facebook', type: 'string', label: '"Сарын багц авах" товчны нэр', default: 'Сарын багц авах' },
  'facebook.publicReplyEnabled': { group: 'facebook', type: 'bool', label: 'Comment-д олон нийтэд хариулах', default: true },
  'facebook.publicReplyText': { group: 'facebook', type: 'string', label: 'Comment хариултын текст', default: 'Танд Messenger-ээр мэдээлэл илгээлээ 📩' },
  'facebook.unknownCodeReply': { group: 'facebook', type: 'string', label: 'Код олдоогүй үеийн хариу (Messenger)', default: 'Уучлаарай, ийм кодтой кино олдсонгүй. Пост дээрх кодыг шалгаад дахин бичнэ үү.' },

  // ── SMTP
  'smtp.host': { group: 'smtp', type: 'string', label: 'SMTP host' },
  'smtp.port': { group: 'smtp', type: 'int', label: 'SMTP port', default: 587, min: 1, max: 65535 },
  'smtp.secure': { group: 'smtp', type: 'bool', label: 'TLS (465 port)', default: false },
  'smtp.user': { group: 'smtp', type: 'string', label: 'Хэрэглэгчийн нэр' },
  'smtp.password': { group: 'smtp', type: 'string', label: 'Нууц үг', secret: true },
  'smtp.from': { group: 'smtp', type: 'string', label: 'Илгээгч (From)', default: 'KinoBox <no-reply@kinobox.mn>' },
} as const satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTINGS;

type ValueOf<D> = D extends { type: 'int' } ? number : D extends { type: 'bool' } ? boolean : string;
export type SettingValue<K extends SettingKey> = ValueOf<(typeof SETTINGS)[K]>;

export const isSettingKey = (key: string): key is SettingKey => Object.hasOwn(SETTINGS, key);

export function getDef(key: SettingKey): SettingDef {
  return SETTINGS[key] as SettingDef;
}
