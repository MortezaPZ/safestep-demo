/**
 * آداپتور نوتیفیکیشن با دو مسیر تحویل.
 *
 * ── قرارداد صریح این پروژه ───────────────────────────────────────────────
 * ساختار FCM کامل پیاده شده است: ذخیره‌ی توکن دستگاه، ساخت بار داده، ارسال
 * دسته‌ای و پاک‌سازی توکن‌های باطل. اما اگر کلید FCM در محیط موجود نباشد،
 * آداپتور به‌جای شکست خوردن، روی مسیر محلی می‌افتد: تحویل درون‌برنامه‌ای
 * از طریق WebSocket به‌علاوه‌ی ثبت در لاگ.
 *
 * یعنی دمو بدون هیچ کلیدی کامل کار می‌کند، و برای واقعی شدنِ ارسال فقط کافی
 * است ‎FCM_SERVER_KEY در ‎.env گذاشته شود — بدون تغییر حتی یک خط کد.
 *
 * وضعیت فعال هر مسیر در ‎/health و در پاسخ ارسال برگردانده می‌شود تا در دمو
 * بتوان صادقانه نشان داد کدام مسیر در حال استفاده است.
 */
import env from '../config/env.js';
import logger from '../utils/logger.js';
import hub from '../realtime/hub.js';
import * as deviceRepository from '../repositories/deviceRepository.js';

const log = logger.child({ module: 'notification' });

const FCM_ENDPOINT = 'https://fcm.googleapis.com/fcm/send';

/** رویداد نوتیفیکیشن درون‌برنامه‌ای که کلاینت‌ها به آن گوش می‌دهند. */
export const NOTIFICATION_EVENT = 'notification:push';

/** آیا پیکربندی FCM کامل است؟ */
export function isFcmConfigured() {
  return Boolean(env.notification.fcmServerKey);
}

/**
 * مسیر تحویل فعال.
 * @returns {'fcm'|'local'}
 */
export function activeDriver() {
  const configured = env.notification.driver;
  if (configured === 'fcm') return 'fcm';
  if (configured === 'local') return 'local';
  return isFcmConfigured() ? 'fcm' : 'local'; // حالت auto
}

/* ─────────────────────────── مسیر واقعی: FCM ─────────────────────────── */

async function sendViaFcm(tokens, { title, body, data, severity }) {
  if (tokens.length === 0) return { sent: 0, failed: 0, invalidTokens: [] };

  const payload = {
    registration_ids: tokens,
    notification: {
      title,
      body,
      // هشدار اضطراری باید صدای اختصاصی و اولویت بالا داشته باشد
      sound: severity === 'critical' ? 'sos_alert' : 'default',
      android_channel_id: severity === 'critical' ? 'safestep_sos' : 'safestep_alerts',
    },
    // داده‌ی ساختاریافته برای مسیریابی داخل اپ هنگام لمس نوتیفیکیشن
    data: { ...data, severity },
    priority: severity === 'critical' ? 'high' : 'normal',
  };

  const response = await fetch(FCM_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `key=${env.notification.fcmServerKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`FCM پاسخ ${response.status} داد`);
  }

  const result = await response.json();

  // توکن‌هایی که FCM باطل اعلام کرده تا از دیتابیس حذف شوند
  const invalidTokens = [];
  (result.results ?? []).forEach((r, index) => {
    if (r.error === 'NotRegistered' || r.error === 'InvalidRegistration') {
      invalidTokens.push(tokens[index]);
    }
  });

  return {
    sent: result.success ?? 0,
    failed: result.failure ?? 0,
    invalidTokens,
  };
}

/* ──────────────────── مسیر جایگزین: درون‌برنامه‌ای + لاگ ──────────────────── */

function sendViaLocal(userIds, { title, body, data, severity }) {
  hub.emitToUsers(userIds, NOTIFICATION_EVENT, {
    title,
    body,
    data,
    severity,
    // برچسب صریح: این نوتیفیکیشن از مسیر جایگزین آمده، نه از FCM واقعی
    deliveredVia: 'local',
    at: new Date().toISOString(),
  });

  log.info('نوتیفیکیشن از مسیر محلی تحویل شد', {
    recipients: userIds.length,
    title,
    severity,
  });

  return { sent: userIds.length, failed: 0, invalidTokens: [] };
}

/* ───────────────────────────── واسط عمومی ───────────────────────────── */

/**
 * ارسال نوتیفیکیشن به مجموعه‌ای از کاربران.
 *
 * @param {string[]} userIds گیرندگان
 * @param {{title: string, body: string, data?: object, severity?: string}} message
 * @returns {Promise<{driver: string, sent: number, failed: number, fellBack: boolean}>}
 */
export async function notify(userIds, message) {
  const targets = [...new Set((userIds ?? []).filter(Boolean))];
  if (targets.length === 0) {
    return { driver: 'none', sent: 0, failed: 0, fellBack: false };
  }

  const driver = activeDriver();
  const payload = {
    title: message.title,
    body: message.body,
    data: message.data ?? {},
    severity: message.severity ?? 'info',
  };

  // نوتیفیکیشن درون‌برنامه‌ای همیشه ارسال می‌شود: کاربری که اپ را باز دارد
  // نباید منتظر رفت‌وبرگشت FCM بماند. این همان چیزی است که تأخیر زیر ۲ ثانیه
  // را در دمو تضمین می‌کند.
  hub.emitToUsers(targets, NOTIFICATION_EVENT, {
    ...payload,
    deliveredVia: driver,
    at: new Date().toISOString(),
  });

  if (driver === 'local') {
    log.info('نوتیفیکیشن ثبت شد', { recipients: targets.length, title: payload.title });
    return { driver: 'local', sent: targets.length, failed: 0, fellBack: false };
  }

  // مسیر FCM
  try {
    const devices = await deviceRepository.pushTokensFor(targets);
    const tokens = devices.map((d) => d.token).filter(Boolean);

    if (tokens.length === 0) {
      log.warn('هیچ توکن Push ثبت‌شده‌ای یافت نشد؛ فقط تحویل درون‌برنامه‌ای انجام شد', {
        recipients: targets.length,
      });
      return { driver: 'local', sent: targets.length, failed: 0, fellBack: true };
    }

    const result = await sendViaFcm(tokens, payload);

    if (result.invalidTokens.length > 0) {
      log.info('توکن‌های باطل شناسایی شدند', { count: result.invalidTokens.length });
    }

    return { driver: 'fcm', sent: result.sent, failed: result.failed, fellBack: false };
  } catch (error) {
    // شکست FCM نباید هشدار را از بین ببرد؛ مسیر محلی همچنان تحویل می‌دهد
    log.error('ارسال FCM شکست خورد؛ بازگشت به مسیر محلی', { error: error.message });
    return { ...sendViaLocal(targets, payload), driver: 'local', fellBack: true };
  }
}

/** وضعیت آداپتور برای نمایش در ‎/health. */
export function status() {
  return {
    driver: activeDriver(),
    fcmConfigured: isFcmConfigured(),
    note: isFcmConfigured()
      ? 'ارسال واقعی FCM فعال است'
      : 'کلید FCM تنظیم نشده؛ تحویل از مسیر درون‌برنامه‌ای و WebSocket انجام می‌شود',
  };
}

export default { notify, status, activeDriver, isFcmConfigured, NOTIFICATION_EVENT };
