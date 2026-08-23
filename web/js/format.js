/**
 * قالب‌بندی فارسی: ارقام، تاریخ شمسی، زمان نسبی و واحدها.
 *
 * تاریخ شمسی از Intl با تقویم persian ساخته می‌شود، نه با کتابخانه‌ی
 * تبدیل دستی. دلیل: این تبدیل بخشی از استاندارد ECMA-402 است، در همه‌ی
 * مرورگرهای مدرن پیاده‌سازی شده و مسائل ریز مثل سال کبیسه را درست
 * مدیریت می‌کند — چیزی که پیاده‌سازی‌های دستی معمولاً در آن اشتباه می‌کنند.
 */

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** تبدیل ارقام لاتین یک رشته به ارقام فارسی. */
export function toFaDigits(value) {
  return String(value ?? '').replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

/** تبدیل ارقام فارسی/عربی به لاتین — برای ورودی‌های کاربر. */
export function toEnDigits(value) {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/** عدد با جداکننده‌ی هزارگان و ارقام فارسی. */
export function faNumber(value, { decimals = 0 } = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const fixed = Number(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return toFaDigits(fixed);
}

/* ─────────────────────────── تاریخ و زمان ─────────────────────────── */

const jalaliDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const jalaliDateShort = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  month: 'long',
  day: 'numeric',
});

const jalaliWeekday = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { weekday: 'long' });

const timeFormat = new Intl.DateTimeFormat('fa-IR', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const toDate = (value) => (value instanceof Date ? value : new Date(value));

/** تاریخ شمسی کامل: «۲ شهریور ۱۴۰۵» */
export function faDate(value) {
  if (!value) return '—';
  return jalaliDate.format(toDate(value));
}

/** تاریخ کوتاه: «۲ شهریور» */
export function faDateShort(value) {
  if (!value) return '—';
  return jalaliDateShort.format(toDate(value));
}

/** ساعت: «۱۴:۳۰» */
export function faTime(value) {
  if (!value) return '—';
  return timeFormat.format(toDate(value));
}

/** روز هفته: «دوشنبه» */
export function faWeekday(value) {
  if (!value) return '—';
  return jalaliWeekday.format(toDate(value));
}

/** تاریخ و ساعت با هم. */
export function faDateTime(value) {
  if (!value) return '—';
  return `${faDate(value)} ساعت ${faTime(value)}`;
}

/**
 * زمان نسبی به فارسی: «۲ دقیقه پیش».
 *
 * برای زیر یک دقیقه عمداً «هم‌اکنون» گفته می‌شود نه «۴۵ ثانیه پیش» —
 * دقت ثانیه‌ای در این محصول نه لازم است و نه مفید، و فقط باعث می‌شود
 * متن مدام تغییر کند و توجه را بی‌جهت جلب کند.
 */
export function faRelativeTime(value) {
  if (!value) return '—';

  const diffMs = Date.now() - toDate(value).getTime();
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);

  const minutes = Math.floor(abs / 60_000);
  const hours = Math.floor(abs / 3_600_000);
  const days = Math.floor(abs / 86_400_000);

  if (abs < 60_000) return 'هم‌اکنون';

  let text;
  if (minutes < 60) text = `${toFaDigits(minutes)} دقیقه`;
  else if (hours < 24) text = `${toFaDigits(hours)} ساعت`;
  else if (days < 30) text = `${toFaDigits(days)} روز`;
  else return faDate(value);

  return future ? `${text} دیگر` : `${text} پیش`;
}

/** آیا این زمان مربوط به امروز است؟ */
export function isToday(value) {
  const d = toDate(value);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** برچسب روز: «امروز» / «دیروز» / تاریخ شمسی */
export function faDayLabel(value) {
  const d = toDate(value);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((startOfToday - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86_400_000);

  if (diffDays === 0) return 'امروز';
  if (diffDays === 1) return 'دیروز';
  return `${faWeekday(d)}، ${faDateShort(d)}`;
}

/* ─────────────────────────── واحدها ─────────────────────────── */

/** فاصله با واحد مناسب: زیر ۱ کیلومتر متر، بالاتر کیلومتر. */
export function faDistance(meters) {
  if (meters === null || meters === undefined) return '—';
  if (meters < 1000) return `${faNumber(Math.round(meters))} متر`;
  return `${faNumber(meters / 1000, { decimals: 1 })} کیلومتر`;
}

/** مدت زمان بر حسب دقیقه. */
export function faDuration(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const total = Math.round(minutes);
  if (total < 60) return `${faNumber(total)} دقیقه`;

  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0
    ? `${faNumber(h)} ساعت`
    : `${faNumber(h)} ساعت و ${faNumber(m)} دقیقه`;
}

export function faSpeed(mps) {
  if (mps === null || mps === undefined) return '—';
  return `${faNumber(mps * 3.6, { decimals: 1 })} کیلومتر بر ساعت`;
}

export function faPercent(value) {
  if (value === null || value === undefined) return '—';
  return `${faNumber(Math.round(value))}٪`;
}

/* ─────────────────────────── برچسب‌های دامنه ─────────────────────────── */

export const ALERT_LABELS = {
  sos: { label: 'درخواست کمک اضطراری', icon: '🆘' },
  zone_exit: { label: 'خروج از محدوده', icon: '🚶' },
  zone_enter: { label: 'بازگشت به محدوده', icon: '🏠' },
  long_stop: { label: 'توقف طولانی', icon: '⏸️' },
  gps_lost: { label: 'قطع ارتباط موقعیت', icon: '📡' },
  low_battery: { label: 'باتری کم', icon: '🔋' },
};

export const PERMISSION_LABELS = {
  view_location: 'مشاهده‌ی موقعیت',
  receive_alerts: 'دریافت هشدار',
  emergency: 'دسترسی اضطراری',
};

export const STATUS_LABELS = {
  inside: 'داخل محدوده‌ی امن',
  outside: 'خارج از محدوده‌ی امن',
  unknown: 'وضعیت نامشخص',
};

export const ZONE_ICONS = {
  home: '🏠',
  hospital: '🏥',
  park: '🌳',
  school: '🏫',
  shop: '🏪',
  other: '📍',
};

/** حروف اول نام برای آواتار. */
export function initials(fullName) {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '؟';
  if (parts.length === 1) return parts[0].slice(0, 1);
  return parts[0].slice(0, 1) + parts[parts.length - 1].slice(0, 1);
}

/** برچسب سطح باتری با آیکون متناسب. */
export function batteryLabel(level) {
  if (level === null || level === undefined) return { text: 'نامشخص', icon: '🔌' };
  const icon = level <= 15 ? '🪫' : '🔋';
  return { text: faPercent(level), icon };
}
