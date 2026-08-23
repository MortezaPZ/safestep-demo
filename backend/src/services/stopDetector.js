/**
 * تشخیص توقف طولانی با پنجره‌ی زمانی متحرک.
 *
 * ── ایده ────────────────────────────────────────────────────────────────
 * پینگ‌های بازه‌ی اخیر را می‌گیریم، مرکز ثقلشان را حساب می‌کنیم و می‌سنجیم
 * که آیا همه‌شان درون دایره‌ای به شعاع مشخص (پیش‌فرض ۴۰ متر) جا می‌شوند یا نه.
 * اگر بله و اگر این وضعیت کل طول پنجره ادامه داشته باشد، یعنی کاربر
 * واقعاً جابه‌جا نشده است.
 *
 * ── چرا شعاع پراکندگی و نه «فاصله‌ی اول تا آخر» ─────────────────────────
 * کسی که یک دور کوتاه بزند و به نقطه‌ی اول برگردد، فاصله‌ی اول‌تاآخرش صفر است
 * ولی متوقف نبوده. شعاع پراکندگی این حالت را درست تشخیص می‌دهد.
 *
 * ── چرا «شکاف داده» جداگانه مدیریت می‌شود ────────────────────────────────
 * اگر GPS ۲۵ دقیقه قطع باشد و کاربر دقیقاً به همان نقطه برگردد، پراکندگی کم
 * می‌شود اما ما در واقع هیچ نمی‌دانیم در آن فاصله چه گذشته است. اعلام
 * «توقف طولانی» در این حالت یک ادعای نادرست است، پس تشخیص را رد می‌کنیم.
 *
 * تمام توابع این ماژول خالص‌اند: زمان به‌صورت پارامتر تزریق می‌شود تا
 * تست‌ها به ساعت سیستم وابسته نباشند.
 */
import { dispersionRadius } from '../utils/geo.js';

export const DEFAULT_STOP_CONFIG = Object.freeze({
  windowMinutes: 20,
  radiusM: 40,
  minPings: 4,
  /** شکاف مجاز بین دو پینگ متوالی (دقیقه). بیش از این، پنجره غیرقابل‌اتکا است. */
  maxGapMinutes: 6,
});

const toMs = (value) => new Date(value).getTime();

/**
 * تشخیص توقف طولانی.
 *
 * @param {Array<{lat:number,lng:number,recordedAt:string|Date}>} pings
 *        پینگ‌های مرتب‌شده به ترتیب زمان صعودی
 * @param {object} [config]
 * @param {number} [now] زمان مرجع بر حسب میلی‌ثانیه (برای تست تزریق می‌شود)
 * @returns {{
 *   isStopped: boolean,
 *   reason: string,
 *   durationMinutes: number,
 *   dispersionM: number|null,
 *   center: {lat:number,lng:number}|null,
 *   pingCount: number,
 *   maxGapMinutes: number|null
 * }}
 */
export function detectStop(pings, config = {}, now = Date.now()) {
  const cfg = { ...DEFAULT_STOP_CONFIG, ...config };

  const empty = {
    isStopped: false,
    durationMinutes: 0,
    dispersionM: null,
    center: null,
    pingCount: 0,
    maxGapMinutes: null,
  };

  if (!Array.isArray(pings) || pings.length === 0) {
    return { ...empty, reason: 'no_data' };
  }

  const windowStart = now - cfg.windowMinutes * 60_000;

  // فقط پینگ‌های داخل پنجره، مرتب بر اساس زمان
  const windowPings = pings
    .filter((p) => toMs(p.recordedAt) >= windowStart && toMs(p.recordedAt) <= now)
    .sort((a, b) => toMs(a.recordedAt) - toMs(b.recordedAt));

  if (windowPings.length < cfg.minPings) {
    return {
      ...empty,
      reason: 'insufficient_pings',
      pingCount: windowPings.length,
    };
  }

  const firstAt = toMs(windowPings[0].recordedAt);
  const lastAt = toMs(windowPings[windowPings.length - 1].recordedAt);
  const durationMinutes = (lastAt - firstAt) / 60_000;

  // بزرگ‌ترین شکاف بین دو پینگ متوالی
  let maxGapMs = 0;
  for (let i = 1; i < windowPings.length; i += 1) {
    const gap = toMs(windowPings[i].recordedAt) - toMs(windowPings[i - 1].recordedAt);
    if (gap > maxGapMs) maxGapMs = gap;
  }
  const maxGap = maxGapMs / 60_000;

  const { center, radiusM: dispersionM } = dispersionRadius(
    windowPings.map((p) => ({ lat: p.lat, lng: p.lng })),
  );

  const base = {
    durationMinutes: Number(durationMinutes.toFixed(2)),
    dispersionM: Number(dispersionM.toFixed(1)),
    center,
    pingCount: windowPings.length,
    maxGapMinutes: Number(maxGap.toFixed(2)),
  };

  // پنجره باید واقعاً پر شده باشد — ۵ دقیقه داده نمی‌تواند «توقف ۲۰ دقیقه‌ای» را ثابت کند.
  // ۹۵٪ گرفته شده تا نوسان چند ثانیه‌ای فاصله‌ی پینگ‌ها باعث رد شدن تشخیص نشود.
  if (durationMinutes < cfg.windowMinutes * 0.95) {
    return { ...base, isStopped: false, reason: 'window_not_covered' };
  }

  if (maxGap > cfg.maxGapMinutes) {
    return { ...base, isStopped: false, reason: 'data_gap' };
  }

  if (dispersionM > cfg.radiusM) {
    return { ...base, isStopped: false, reason: 'moving' };
  }

  return { ...base, isStopped: true, reason: 'stopped' };
}

/**
 * آیا از آخرین هشدار توقف، فاصله‌ی کافی گذشته است؟
 *
 * دوره‌ی خاموشی برابر خودِ طول پنجره است: کسی که یک ساعت در کافه نشسته،
 * باید یک هشدار بگیرد نه سه تا. هشدار بعدی تنها وقتی معنا دارد که
 * یک پنجره‌ی کامل دیگر از توقف گذشته باشد.
 */
export function shouldAlertStop(lastStopAlertAt, config = {}, now = Date.now()) {
  const cfg = { ...DEFAULT_STOP_CONFIG, ...config };
  if (!lastStopAlertAt) return true;
  return now - toMs(lastStopAlertAt) >= cfg.windowMinutes * 60_000;
}

/**
 * تشخیص قطع ارتباط GPS: از آخرین پینگ بیش از حد مجاز گذشته است.
 */
export function detectGpsLost(lastPingAt, thresholdSec, now = Date.now()) {
  if (!lastPingAt) return { isLost: false, silentSeconds: 0, reason: 'no_data' };
  const silentSeconds = (now - toMs(lastPingAt)) / 1000;
  return {
    isLost: silentSeconds > thresholdSec,
    silentSeconds: Math.round(silentSeconds),
    reason: silentSeconds > thresholdSec ? 'gps_lost' : 'ok',
  };
}
