/**
 * سرویس هشدار — ساخت، توزیع و مدیریت هشدارها.
 *
 * ── قاعده‌ی مرکزی توزیع ──────────────────────────────────────────────────
 * گیرندگان هر هشدار از روی سطح دسترسیِ ثبت‌شده در رابطه‌ی سرپرستی تعیین
 * می‌شوند، نه از روی چیزی که کلاینت ادعا می‌کند. هشدار SOS فقط به کسانی
 * می‌رسد که دسترسی «اضطراری» دارند و بقیه‌ی هشدارها فقط به دارندگان
 * «دریافت هشدار». این فیلتر در کوئری دیتابیس اعمال می‌شود تا امکان
 * فراموش شدنش در لایه‌های بالاتر وجود نداشته باشد.
 */
import {
  ALERT_TYPES,
  ALERT_SEVERITY,
  ALERT_REQUIRED_PERMISSION,
  WS_EVENTS,
} from '../config/constants.js';
import * as alertRepository from '../repositories/alertRepository.js';
import * as guardianshipRepository from '../repositories/guardianshipRepository.js';
import * as userRepository from '../repositories/userRepository.js';
import hub from '../realtime/hub.js';
import notificationAdapter from './notificationAdapter.js';
import logger from '../utils/logger.js';
import { forbidden, notFound } from '../utils/errors.js';

const log = logger.child({ module: 'alert' });

/* ──────────────────────── متن‌سازی هشدارها ──────────────────────── */

/**
 * ساخت عنوان و متن فارسی هشدار.
 * متن‌ها اینجا متمرکز شده‌اند تا لحن یکدست بماند: خبری و آرام، نه هشدارآمیز.
 * لحن ترسناک در محصولی که هر روز استفاده می‌شود، به بی‌اعتنایی ختم می‌شود.
 */
export function composeAlertMessage(type, context = {}) {
  const name = context.userName ?? 'کاربر';
  const zone = context.zoneName ?? 'محدوده‌ی امن';

  switch (type) {
    case ALERT_TYPES.SOS:
      return {
        title: 'درخواست کمک اضطراری',
        body: `${name} دکمه‌ی اضطراری را فشرده است. لطفاً هرچه سریع‌تر تماس بگیرید.`,
      };

    case ALERT_TYPES.ZONE_EXIT:
      return {
        title: 'خروج از محدوده‌ی امن',
        body: `${name} از «${zone}» خارج شد.`,
      };

    case ALERT_TYPES.ZONE_ENTER:
      return {
        title: 'بازگشت به محدوده‌ی امن',
        body: `${name} به «${zone}» بازگشت.`,
      };

    case ALERT_TYPES.LONG_STOP: {
      const minutes = Math.round(context.durationMinutes ?? 0);
      return {
        title: 'توقف طولانی',
        body: `${name} حدود ${minutes} دقیقه در یک نقطه متوقف بوده است.`,
      };
    }

    case ALERT_TYPES.GPS_LOST: {
      const minutes = Math.round((context.silentSeconds ?? 0) / 60);
      return {
        title: 'قطع ارتباط موقعیت',
        body: `حدود ${minutes} دقیقه است موقعیت ${name} دریافت نشده است.`,
      };
    }

    case ALERT_TYPES.LOW_BATTERY:
      return {
        title: 'باتری کم',
        body: `شارژ باتری دستگاه ${name} به ${context.batteryLevel ?? 0} درصد رسیده است.`,
      };

    default:
      return { title: 'هشدار', body: `رویدادی برای ${name} ثبت شد.` };
  }
}

/* ──────────────────────── ساخت و توزیع ──────────────────────── */

/**
 * ثبت یک هشدار و رساندن آن به اعضای مجاز خانواده.
 *
 * @param {object} params
 * @param {string} params.userId کاربر اصلی که هشدار درباره‌ی اوست
 * @param {string} params.type نوع هشدار
 * @param {{lat?: number, lng?: number}} [params.location]
 * @param {string} [params.zoneId]
 * @param {object} [params.context] داده‌ی لازم برای متن‌سازی
 * @param {object} [params.metadata] داده‌ی ساختاریافته‌ی اضافی
 */
export async function raiseAlert({ userId, type, location, zoneId, context = {}, metadata = {} }) {
  const subject = await userRepository.findById(userId);
  if (!subject) throw notFound('کاربر یافت نشد.');

  const severity = ALERT_SEVERITY[type] ?? 'warning';
  const { title, body } = composeAlertMessage(type, { ...context, userName: subject.fullName });

  const alert = await alertRepository.create({
    userId,
    type,
    severity,
    title,
    body,
    lat: location?.lat ?? null,
    lng: location?.lng ?? null,
    zoneId: zoneId ?? null,
    metadata,
  });

  // گیرندگان بر اساس سطح دسترسی لازم برای این نوع هشدار
  const requiredPermission = ALERT_REQUIRED_PERMISSION[type];
  const recipients = await guardianshipRepository.listRecipientsForPermission(
    userId,
    requiredPermission,
  );
  const recipientIds = recipients.map((r) => r.id);

  const enriched = {
    ...alert,
    subject: {
      id: subject.id,
      fullName: subject.fullName,
      avatarColor: subject.avatarColor,
    },
    zoneName: context.zoneName ?? null,
  };

  // کاربر اصلی هم نسخه‌ی خودش را می‌بیند — او باید بداند چه چیزی
  // درباره‌اش به خانواده گزارش شده است. شفافیت، شرط استقلال است.
  hub.emitToUsers([...recipientIds, userId], WS_EVENTS.ALERT_NEW, enriched);

  const delivery = await notificationAdapter.notify(recipientIds, {
    title,
    body,
    severity,
    data: {
      alertId: alert.id,
      type,
      subjectId: userId,
      ...(zoneId ? { zoneId } : {}),
    },
  });

  log.info('هشدار ثبت و توزیع شد', {
    alertId: alert.id,
    type,
    severity,
    recipients: recipientIds.length,
    deliveredVia: delivery.driver,
  });

  return { alert: enriched, recipients, delivery };
}

/* ──────────────────────── خواندن و مدیریت ──────────────────────── */

/**
 * فهرست کاربرانی که یک بیننده اجازه‌ی دیدن هشدارهایشان را دارد.
 * شامل خودش (هشدارهای مربوط به خودش) و کاربران اصلی‌ای که دسترسی دارد.
 */
export async function visibleSubjectIds(viewerId) {
  const links = await guardianshipRepository.listPrimariesFor(viewerId);
  const permitted = links
    .filter((l) => l.permissions.includes('receive_alerts') || l.permissions.includes('emergency'))
    .map((l) => l.primaryUserId);

  return [...new Set([viewerId, ...permitted])];
}

export async function listAlerts(viewerId, { types, unreadOnly, limit, before, subjectId } = {}) {
  let subjectIds = await visibleSubjectIds(viewerId);

  // اگر بیننده روی یک کاربر خاص فیلتر کرده، باید در فهرست مجازش باشد
  if (subjectId) {
    if (!subjectIds.includes(subjectId)) {
      throw forbidden('شما به هشدارهای این کاربر دسترسی ندارید.');
    }
    subjectIds = [subjectId];
  }

  const [alerts, counts, unreadCount] = await Promise.all([
    alertRepository.list(subjectIds, viewerId, { types, unreadOnly, limit, before }),
    alertRepository.countsByType(subjectIds),
    alertRepository.countUnread(subjectIds, viewerId),
  ]);

  return { alerts, countsByType: counts, unreadCount };
}

export async function markRead(alertId, viewerId) {
  const alert = await alertRepository.findById(alertId);
  if (!alert) throw notFound('هشدار یافت نشد.');

  const allowed = await visibleSubjectIds(viewerId);
  if (!allowed.includes(alert.userId)) {
    throw forbidden('شما به این هشدار دسترسی ندارید.');
  }

  await alertRepository.markRead(alertId, viewerId);
  hub.emitToUser(viewerId, WS_EVENTS.ALERT_READ, { alertId });

  return { ok: true };
}

export async function markAllRead(viewerId) {
  const subjectIds = await visibleSubjectIds(viewerId);
  const count = await alertRepository.markAllRead(subjectIds, viewerId);
  return { ok: true, count };
}

/**
 * بستن یک هشدار.
 * هم کاربر اصلی می‌تواند هشدار خودش را ببندد (مثلاً SOS اشتباهی)،
 * هم عضو خانواده‌ای که به آن دسترسی دارد.
 */
export async function resolveAlert(alertId, viewerId) {
  const alert = await alertRepository.findById(alertId);
  if (!alert) throw notFound('هشدار یافت نشد.');

  const allowed = await visibleSubjectIds(viewerId);
  if (!allowed.includes(alert.userId)) {
    throw forbidden('شما به این هشدار دسترسی ندارید.');
  }

  const resolved = await alertRepository.resolve(alertId, viewerId);
  if (!resolved) return alert; // از قبل بسته شده بود

  const recipients = await guardianshipRepository.listRecipientsForPermission(
    alert.userId,
    ALERT_REQUIRED_PERMISSION[alert.type],
  );

  hub.emitToUsers(
    [...recipients.map((r) => r.id), alert.userId],
    WS_EVENTS.ALERT_NEW,
    { ...resolved, isResolution: true },
  );

  log.info('هشدار بسته شد', { alertId, by: viewerId });
  return resolved;
}

export default {
  raiseAlert,
  listAlerts,
  markRead,
  markAllRead,
  resolveAlert,
  visibleSubjectIds,
  composeAlertMessage,
};
