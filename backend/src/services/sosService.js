/**
 * سرویس SOS — مسیر بحرانی سیستم.
 *
 * ── اصول طراحی این مسیر ──────────────────────────────────────────────────
 *
 * ۱) SOS هرگز به‌خاطر تنظیمات مسدود نمی‌شود. حتی اگر کاربر اشتراک موقعیت را
 *    خاموش کرده باشد، فشردن دکمه‌ی اضطراری یعنی خودش خواسته است دیده شود.
 *    این تنها استثنای قاعده‌ی اشتراک‌گذاری است و عمدی است.
 *
 * ۲) اگر پینگ تازه‌ای در دست نباشد، هشدار با آخرین موقعیت شناخته‌شده و
 *    برچسب صریحِ «قدیمی» ارسال می‌شود. هشدار بدون مختصات، بهتر از
 *    هیچ هشدار است؛ اما مختصات قدیمیِ بدون برچسب، بدتر از هر دو.
 *
 * ۳) لغو در سمت کلاینت با شمارش معکوس انجام می‌شود، نه با درخواست به سرور.
 *    اگر درخواست ارسال و بعد لغو شود، خانواده یک هشدار قرمز دیده و
 *    وحشت کرده است. پس تا پایان شمارش معکوس، هیچ درخواستی فرستاده نمی‌شود.
 */
import { ALERT_TYPES, PERMISSIONS } from '../config/constants.js';
import * as locationRepository from '../repositories/locationRepository.js';
import * as guardianshipRepository from '../repositories/guardianshipRepository.js';
import * as alertRepository from '../repositories/alertRepository.js';
import { raiseAlert } from './alertService.js';
import { detectGpsLost } from './stopDetector.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'sos' });

/** موقعیتی که از این قدیمی‌تر باشد، «قدیمی» برچسب می‌خورد. */
const STALE_LOCATION_SEC = 120;

/**
 * فعال‌سازی هشدار اضطراری.
 *
 * @param {string} userId کاربری که دکمه را فشرده
 * @param {object} [payload]
 * @param {number} [payload.lat] موقعیت لحظه‌ای اگر کلاینت داشته باشد
 * @param {number} [payload.lng]
 * @param {number} [payload.batteryLevel]
 * @param {string} [payload.note] یادداشت اختیاری کاربر
 */
export async function triggerSos(userId, payload = {}) {
  const startedAt = Date.now();

  // موقعیت: اولویت با مختصات لحظه‌ای کلاینت، سپس آخرین پینگ ثبت‌شده
  let location = null;
  let locationSource = 'none';
  let isStale = false;

  if (typeof payload.lat === 'number' && typeof payload.lng === 'number') {
    location = { lat: payload.lat, lng: payload.lng };
    locationSource = 'live';

    // موقعیت لحظه‌ای SOS ثبت هم می‌شود تا در تاریخچه‌ی مسیر دیده شود
    await locationRepository.insertPing({
      userId,
      lat: payload.lat,
      lng: payload.lng,
      accuracyM: payload.accuracyM ?? null,
      batteryLevel: payload.batteryLevel ?? null,
      isSimulated: Boolean(payload.isSimulated),
      recordedAt: new Date(),
    });
  } else {
    const last = await locationRepository.findLatest(userId);
    if (last) {
      location = { lat: last.lat, lng: last.lng };
      locationSource = 'last_known';
      isStale = detectGpsLost(last.recordedAt, STALE_LOCATION_SEC).isLost;
    }
  }

  const { alert, recipients, delivery } = await raiseAlert({
    userId,
    type: ALERT_TYPES.SOS,
    location,
    metadata: {
      locationSource,
      isStaleLocation: isStale,
      batteryLevel: payload.batteryLevel ?? null,
      note: payload.note ?? null,
      triggeredAt: new Date().toISOString(),
    },
  });

  const elapsedMs = Date.now() - startedAt;

  log.warn('هشدار اضطراری فعال شد', {
    userId,
    alertId: alert.id,
    recipients: recipients.length,
    locationSource,
    isStale,
    elapsedMs,
  });

  return {
    alert,
    recipients: recipients.map((r) => ({ id: r.id, fullName: r.fullName })),
    delivery,
    location: {
      source: locationSource,
      isStale,
      hasLocation: Boolean(location),
    },
    elapsedMs,
  };
}

/**
 * فهرست مخاطبان اضطراری کاربر — برای نمایش در دیالوگ تأیید SOS.
 * کاربر پیش از فشردن دکمه باید بداند دقیقاً چه کسانی مطلع می‌شوند.
 */
export async function emergencyContacts(userId) {
  const contacts = await guardianshipRepository.listRecipientsForPermission(
    userId,
    PERMISSIONS.EMERGENCY,
  );

  return {
    contacts,
    count: contacts.length,
    hasContacts: contacts.length > 0,
    warning:
      contacts.length === 0
        ? 'هیچ مخاطب اضطراری ثبت نشده است. یک عضو خانواده با دسترسی اضطراری اضافه کنید.'
        : null,
  };
}

/** آخرین هشدار اضطراری باز — برای نمایش نوار قرمز پایدار در داشبورد خانواده. */
export async function activeSos(userId) {
  const last = await alertRepository.findLastOfType(userId, ALERT_TYPES.SOS);
  if (!last || last.resolvedAt) return null;

  // هشدار اضطراری قدیمی‌تر از ۶ ساعت دیگر «فعال» تلقی نمی‌شود
  const ageMs = Date.now() - new Date(last.createdAt).getTime();
  if (ageMs > 6 * 3600 * 1000) return null;

  return last;
}

/** پیکربندی SOS برای کلاینت — شمارش معکوس و محدودیت نرخ. */
export function sosConfig() {
  return {
    countdownSeconds: 3,
    rateLimit: {
      max: env.rateLimit.sosMax,
      windowSeconds: Math.floor(env.rateLimit.sosWindowMs / 1000),
    },
  };
}

export default { triggerSos, emergencyContacts, activeSos, sosConfig };
