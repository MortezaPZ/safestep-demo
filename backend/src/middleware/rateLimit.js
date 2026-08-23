/**
 * محدودسازی نرخ درخواست.
 *
 * سه محدودکننده با منطق متفاوت:
 *   • auth   → بر اساس IP، جلوی حدس زدن رمز عبور را می‌گیرد
 *   • sos    → بر اساس کاربر، جلوی سیل هشدار اضطراری را می‌گیرد
 *   • invite → بر اساس کاربر، جلوی تولید انبوه کد دعوت را می‌گیرد
 *
 * نکته‌ی مهم درباره‌ی SOS: محدودیت عمداً سخاوتمندانه است (پیش‌فرض: ۳ بار در
 * دقیقه). کسی که واقعاً در خطر است ممکن است چند بار دکمه را بزند و مسدود
 * کردنش خطرناک‌تر از چند هشدار تکراری است. هدف صرفاً جلوگیری از سوءاستفاده
 * یا حلقه‌ی معیوب کلاینت است، نه محدود کردن کاربر مضطرب.
 */
import rateLimit from 'express-rate-limit';
import env from '../config/env.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'rate-limit' });

/** پاسخ یکدست برای همه‌ی محدودکننده‌ها. */
const buildHandler = (label, message) => (req, res) => {
  log.warn('سقف نرخ درخواست رد شد', {
    limiter: label,
    path: req.path,
    userId: req.user?.id ?? null,
  });

  res.status(429).json({
    error: { code: 'TOO_MANY_REQUESTS', message },
  });
};

/** کلید بر اساس کاربر واردشده؛ اگر وارد نشده باشد، بر اساس IP. */
const userKey = (req) => req.user?.id ?? req.ip;

export const authLimiter = rateLimit({
  windowMs: env.rateLimit.authWindowMs,
  max: env.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  // ورودهای موفق شمرده نمی‌شوند؛ هدف، جلوگیری از حدس زدن است نه محدود کردن کاربر واقعی
  skipSuccessfulRequests: true,
  handler: buildHandler(
    'auth',
    'تعداد تلاش‌های ناموفق زیاد است. لطفاً چند دقیقه بعد دوباره تلاش کنید.',
  ),
});

export const sosLimiter = rateLimit({
  windowMs: env.rateLimit.sosWindowMs,
  max: env.rateLimit.sosMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  handler: buildHandler(
    'sos',
    'هشدار اضطراری شما ثبت شده است. برای ارسال مجدد کمی صبر کنید.',
  ),
});

export const inviteLimiter = rateLimit({
  windowMs: env.rateLimit.inviteWindowMs,
  max: env.rateLimit.inviteMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  handler: buildHandler('invite', 'تعداد کدهای دعوت ساخته‌شده زیاد است. کمی بعد تلاش کنید.'),
});

/**
 * محدودکننده‌ی عمومی برای بقیه‌ی مسیرها.
 * سقف بالا انتخاب شده چون پینگ موقعیت می‌تواند پرتکرار باشد.
 */
export const generalLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  handler: buildHandler('general', 'تعداد درخواست‌ها بیش از حد مجاز است.'),
});
