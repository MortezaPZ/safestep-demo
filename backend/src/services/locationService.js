/**
 * سرویس موقعیت — خط لوله‌ی اصلی سیستم.
 *
 * هر پینگ موقعیت از این مسیر عبور می‌کند:
 *
 *   ثبت پینگ
 *     └→ به‌روزرسانی وضعیت دستگاه (باتری)
 *     └→ پخش زنده به اعضای مجاز خانواده
 *     └→ موتور Geofence  → هشدار خروج/بازگشت
 *     └→ تشخیص توقف طولانی → هشدار توقف
 *     └→ بررسی باتری کم → هشدار باتری
 *
 * ── تنش استقلال و ایمنی، به‌صورت کد ─────────────────────────────────────
 * وقتی کاربر اشتراک موقعیت را قطع می‌کند:
 *   • پینگ‌ها همچنان ثبت می‌شوند (تاریخچه‌ی خودِ کاربر، متعلق به خودِ اوست)
 *   • هیچ موقعیتی به خانواده پخش نمی‌شود
 *   • هیچ هشدار مبتنی بر موقعیت تولید نمی‌شود — چون خودِ هشدار «خروج از خانه»
 *     هم یک نشت موقعیت است، حتی اگر مختصات را نفرستد
 *   • اما SOS همچنان کار می‌کند، چون کاربر خودش آن را آغاز کرده است
 */
import env from '../config/env.js';
import {
  ALERT_TYPES,
  PERMISSIONS,
  WS_EVENTS,
  ZONE_STATE,
} from '../config/constants.js';
import * as locationRepository from '../repositories/locationRepository.js';
import * as safeZoneRepository from '../repositories/safeZoneRepository.js';
import * as guardianshipRepository from '../repositories/guardianshipRepository.js';
import * as userRepository from '../repositories/userRepository.js';
import * as deviceRepository from '../repositories/deviceRepository.js';
import * as alertRepository from '../repositories/alertRepository.js';
import { evaluateZone, isCooldownElapsed, summarizeState } from './geofenceEngine.js';
import { detectStop, shouldAlertStop, detectGpsLost } from './stopDetector.js';
import { raiseAlert } from './alertService.js';
import hub from '../realtime/hub.js';
import logger from '../utils/logger.js';
import { forbidden, notFound } from '../utils/errors.js';

const log = logger.child({ module: 'location' });

const geofenceConfig = {
  hysteresisM: env.geofence.hysteresisM,
  debounceCount: env.geofence.debounceCount,
  cooldownSec: env.geofence.cooldownSec,
};

/** آستانه‌ی هشدار باتری کم. یک بار در هر عبور از این حد هشدار داده می‌شود. */
const LOW_BATTERY_THRESHOLD = 15;

/* ─────────────────────────── دریافت پینگ ─────────────────────────── */

/**
 * ثبت و پردازش یک پینگ موقعیت.
 *
 * @param {string} userId
 * @param {object} data lat, lng, accuracyM, speedMps, headingDeg, batteryLevel, isSimulated, recordedAt
 * @returns {Promise<object>} پینگ ثبت‌شده به‌همراه خلاصه‌ی وضعیت و هشدارهای تولیدشده
 */
export async function ingestPing(userId, data) {
  const settings = await userRepository.getSettings(userId);
  if (!settings) throw notFound('کاربر یافت نشد.');

  const ping = await locationRepository.insertPing({ userId, ...data });

  if (data.batteryLevel !== undefined && data.batteryLevel !== null) {
    await deviceRepository.touch(userId, { batteryLevel: data.batteryLevel });
  }

  const sharingEnabled = settings.locationSharingEnabled;
  const generatedAlerts = [];

  // ── پخش زنده ────────────────────────────────────────────────────────
  const viewers = sharingEnabled
    ? await guardianshipRepository.listRecipientsForPermission(userId, PERMISSIONS.VIEW_LOCATION)
    : [];

  // کاربر اصلی همیشه موقعیت خودش را می‌بیند، فارغ از تنظیم اشتراک‌گذاری
  hub.emitToUsers([...viewers.map((v) => v.id), userId], WS_EVENTS.LOCATION_UPDATE, {
    userId,
    lat: ping.lat,
    lng: ping.lng,
    accuracyM: ping.accuracyM,
    speedMps: ping.speedMps,
    headingDeg: ping.headingDeg,
    batteryLevel: ping.batteryLevel,
    isSimulated: ping.isSimulated,
    recordedAt: ping.recordedAt,
    sharingEnabled,
  });

  // ── موتور Geofence ──────────────────────────────────────────────────
  const zoneResults = await evaluateGeofences(userId, ping, {
    allowAlerts: sharingEnabled && settings.alertTypes.includes(ALERT_TYPES.ZONE_EXIT),
    userName: null,
  });
  generatedAlerts.push(...zoneResults.alerts);

  // ── تشخیص توقف طولانی ────────────────────────────────────────────────
  if (sharingEnabled && settings.alertTypes.includes(ALERT_TYPES.LONG_STOP)) {
    const stopAlert = await evaluateLongStop(userId, settings, ping);
    if (stopAlert) generatedAlerts.push(stopAlert);
  }

  // ── باتری کم ────────────────────────────────────────────────────────
  if (
    sharingEnabled &&
    settings.alertTypes.includes(ALERT_TYPES.LOW_BATTERY) &&
    typeof ping.batteryLevel === 'number' &&
    ping.batteryLevel <= LOW_BATTERY_THRESHOLD
  ) {
    const last = await alertRepository.findLastOfType(userId, ALERT_TYPES.LOW_BATTERY);
    // یک هشدار در هر ۶ ساعت کافی است
    const elapsed = last ? Date.now() - new Date(last.createdAt).getTime() : Infinity;
    if (elapsed > 6 * 3600 * 1000) {
      const { alert } = await raiseAlert({
        userId,
        type: ALERT_TYPES.LOW_BATTERY,
        location: { lat: ping.lat, lng: ping.lng },
        context: { batteryLevel: ping.batteryLevel },
        metadata: { batteryLevel: ping.batteryLevel },
      });
      generatedAlerts.push(alert);
    }
  }

  return {
    ping,
    status: zoneResults.summary,
    zones: zoneResults.states,
    alerts: generatedAlerts,
    sharingEnabled,
  };
}

/* ─────────────────────────── موتور Geofence ─────────────────────────── */

/**
 * ارزیابی موقعیت در برابر تمام محدوده‌های فعال کاربر و ثبت وضعیت جدید.
 * هشدار تنها وقتی صادر می‌شود که هر سه شرط برقرار باشد:
 *   تغییر وضعیت تأیید شده باشد، رویداد قابل گزارش باشد، و دوره‌ی خاموشی گذشته باشد.
 */
async function evaluateGeofences(userId, ping, { allowAlerts }) {
  const zones = await safeZoneRepository.listByUser(userId, { onlyActive: true });

  if (zones.length === 0) {
    return { summary: summarizeState([]), states: [], alerts: [] };
  }

  const previousStates = await safeZoneRepository.listStatesForUser(userId);
  const stateByZone = new Map(previousStates.map((s) => [s.zoneId, s]));

  const alerts = [];
  const states = [];

  for (const zone of zones) {
    const previous = stateByZone.get(zone.id) ?? null;
    const result = evaluateZone({ lat: ping.lat, lng: ping.lng }, zone, previous, geofenceConfig);

    const reportable = result.event === 'exit' || result.event === 'enter';
    const cooldownOk = isCooldownElapsed(previous?.lastAlertAt, geofenceConfig);
    const willAlert = Boolean(allowAlerts && reportable && cooldownOk);

    await safeZoneRepository.upsertZoneState({
      userId,
      zoneId: zone.id,
      state: result.state,
      consecutiveCount: result.consecutiveCount,
      pendingState: result.pendingState,
      lastDistanceM: result.distanceM,
      transitioned: result.transitioned,
      alerted: willAlert,
    });

    states.push({
      zoneId: zone.id,
      zoneName: zone.name,
      state: result.state,
      distanceM: Math.round(result.distanceM),
      radiusM: zone.radiusM,
      thresholds: result.thresholds,
    });

    if (result.transitioned) {
      // تغییر وضعیت همیشه به کاربر اصلی و بینندگان مجاز اعلام می‌شود،
      // حتی وقتی هشدار رسمی صادر نمی‌شود (مثلاً اولین ارزیابی)
      const viewers = allowAlerts
        ? await guardianshipRepository.listRecipientsForPermission(userId, PERMISSIONS.VIEW_LOCATION)
        : [];
      hub.emitToUsers([...viewers.map((v) => v.id), userId], WS_EVENTS.ZONE_STATE, {
        userId,
        zoneId: zone.id,
        zoneName: zone.name,
        state: result.state,
        distanceM: Math.round(result.distanceM),
      });
    }

    if (willAlert) {
      const { alert } = await raiseAlert({
        userId,
        type: result.event === 'exit' ? ALERT_TYPES.ZONE_EXIT : ALERT_TYPES.ZONE_ENTER,
        location: { lat: ping.lat, lng: ping.lng },
        zoneId: zone.id,
        context: { zoneName: zone.name },
        metadata: {
          distanceM: Math.round(result.distanceM),
          radiusM: zone.radiusM,
          exitThresholdM: Math.round(result.thresholds.exitThresholdM),
          enterThresholdM: Math.round(result.thresholds.enterThresholdM),
          isSimulated: ping.isSimulated,
        },
      });
      alerts.push(alert);

      log.info('تغییر وضعیت محدوده تأیید شد', {
        userId,
        zoneId: zone.id,
        event: result.event,
      });
    } else if (reportable && !cooldownOk) {
      log.debug('هشدار به دلیل دوره‌ی خاموشی صادر نشد', { userId, zoneId: zone.id });
    }
  }

  return { summary: summarizeState(states), states, alerts };
}

/* ─────────────────────── تشخیص توقف طولانی ─────────────────────── */

async function evaluateLongStop(userId, settings, ping) {
  const windowMinutes = settings.longStopMinutes;
  const pings = await locationRepository.findRecentWindow(userId, windowMinutes);

  const result = detectStop(pings, {
    windowMinutes,
    radiusM: settings.longStopRadiusM,
    minPings: env.stopDetect.minPings,
  });

  if (!result.isStopped) return null;

  const last = await alertRepository.findLastOfType(userId, ALERT_TYPES.LONG_STOP);
  if (!shouldAlertStop(last?.createdAt, { windowMinutes })) return null;

  const { alert } = await raiseAlert({
    userId,
    type: ALERT_TYPES.LONG_STOP,
    location: { lat: ping.lat, lng: ping.lng },
    context: { durationMinutes: result.durationMinutes },
    metadata: {
      durationMinutes: result.durationMinutes,
      dispersionM: result.dispersionM,
      pingCount: result.pingCount,
      radiusM: settings.longStopRadiusM,
    },
  });

  log.info('توقف طولانی تشخیص داده شد', {
    userId,
    durationMinutes: result.durationMinutes,
    dispersionM: result.dispersionM,
  });

  return alert;
}

/* ─────────────────────── خواندن موقعیت (با کنترل دسترسی) ─────────────────────── */

/**
 * بررسی اینکه بیننده اجازه‌ی دیدن موقعیت یک کاربر را دارد یا نه.
 * سه شرط: خودِ کاربر باشد، یا رابطه‌ی فعال با دسترسی view_location داشته باشد،
 * و مهم‌تر از همه: کاربر اصلی اشتراک‌گذاری را خاموش نکرده باشد.
 */
export async function assertCanViewLocation(viewerId, subjectId) {
  if (viewerId === subjectId) return { allowed: true, sharingEnabled: true, isSelf: true };

  const permitted = await guardianshipRepository.hasPermission(
    subjectId,
    viewerId,
    PERMISSIONS.VIEW_LOCATION,
  );
  if (!permitted) throw forbidden('شما به موقعیت این کاربر دسترسی ندارید.');

  const settings = await userRepository.getSettings(subjectId);
  if (!settings) throw notFound('کاربر یافت نشد.');

  return { allowed: true, sharingEnabled: settings.locationSharingEnabled, isSelf: false };
}

/**
 * آخرین موقعیت یک کاربر.
 * اگر اشتراک‌گذاری خاموش باشد، به‌جای خطا یک پاسخ صریح «مخفی» برمی‌گردانیم
 * تا رابط کاربری بتواند حالت محترمانه‌ی «موقعیت مخفی شد» را نشان دهد،
 * نه پیام خطا. تفاوت این دو، تفاوت حس نظارت و حس احترام است.
 */
export async function getCurrentLocation(viewerId, subjectId) {
  const access = await assertCanViewLocation(viewerId, subjectId);

  if (!access.sharingEnabled) {
    return {
      userId: subjectId,
      hidden: true,
      reason: 'sharing_disabled',
      message: 'کاربر اشتراک‌گذاری موقعیت را موقتاً خاموش کرده است.',
      location: null,
      status: null,
    };
  }

  const [ping, zoneStates] = await Promise.all([
    locationRepository.findLatest(subjectId),
    safeZoneRepository.listStatesForUser(subjectId),
  ]);

  const gps = detectGpsLost(ping?.recordedAt, env.gpsLostAfterSec);

  return {
    userId: subjectId,
    hidden: false,
    location: ping,
    status: summarizeState(zoneStates),
    zones: zoneStates,
    gps: { isStale: gps.isLost, silentSeconds: gps.silentSeconds },
  };
}

/** آخرین موقعیت همه‌ی کاربرانی که بیننده به آن‌ها دسترسی دارد — برای داشبورد خانواده. */
export async function getWatchList(viewerId) {
  const links = await guardianshipRepository.listPrimariesFor(viewerId);
  const visible = links.filter((l) => l.permissions.includes(PERMISSIONS.VIEW_LOCATION));

  const results = await Promise.all(
    visible.map(async (link) => {
      const current = await getCurrentLocation(viewerId, link.primaryUserId);
      return {
        guardianshipId: link.id,
        permissions: link.permissions,
        user: link.primaryUser,
        ...current,
        isOnline: hub.isUserOnline(link.primaryUserId),
      };
    }),
  );

  return results;
}

export async function getHistory(viewerId, subjectId, { from, to, limit }) {
  const access = await assertCanViewLocation(viewerId, subjectId);

  if (!access.sharingEnabled) {
    return { hidden: true, reason: 'sharing_disabled', points: [], stats: null };
  }

  const [points, stats] = await Promise.all([
    locationRepository.findHistory(subjectId, { from, to, limit }),
    locationRepository.dayStats(subjectId, from, to),
  ]);

  return { hidden: false, points, stats };
}

export async function getHistoryDays(viewerId, subjectId) {
  await assertCanViewLocation(viewerId, subjectId);
  return locationRepository.listHistoryDays(subjectId);
}

/**
 * حذف تاریخچه — فقط توسط خودِ کاربر.
 * حتی عضو خانواده با دسترسی اضطراری هم نمی‌تواند تاریخچه‌ی کسی را پاک کند؛
 * این داده متعلق به کاربر اصلی است.
 */
export async function deleteHistory(userId, { from, to } = {}) {
  const deleted = await locationRepository.deleteHistory(userId, { from, to });
  log.info('تاریخچه‌ی موقعیت حذف شد', { userId, deletedRows: deleted, scoped: Boolean(from || to) });
  return { deleted };
}

/**
 * تغییر وضعیت اشتراک‌گذاری موقعیت.
 * به محض خاموش شدن، به همه‌ی بینندگان اطلاع داده می‌شود تا نقشه‌شان
 * بلافاصله به حالت «مخفی» برود — بدون نیاز به تازه‌سازی صفحه.
 */
export async function setLocationSharing(userId, enabled) {
  const settings = await userRepository.updateSettings(userId, {
    locationSharingEnabled: enabled,
  });

  const viewers = await guardianshipRepository.listRecipientsForPermission(
    userId,
    PERMISSIONS.VIEW_LOCATION,
  );

  hub.emitToUsers([...viewers.map((v) => v.id), userId], WS_EVENTS.SHARING_CHANGED, {
    userId,
    sharingEnabled: enabled,
    at: new Date().toISOString(),
  });

  log.info('وضعیت اشتراک‌گذاری موقعیت تغییر کرد', { userId, enabled, viewers: viewers.length });

  return settings;
}

/** خلاصه‌ی وضعیت کاربر برای کارت بالای داشبورد خودش. */
export async function getOwnStatus(userId) {
  const [ping, zoneStates, settings, zones] = await Promise.all([
    locationRepository.findLatest(userId),
    safeZoneRepository.listStatesForUser(userId),
    userRepository.getSettings(userId),
    safeZoneRepository.listByUser(userId, { onlyActive: true }),
  ]);

  const gps = detectGpsLost(ping?.recordedAt, env.gpsLostAfterSec);
  const summary = summarizeState(zoneStates);

  const viewers = await guardianshipRepository.listRecipientsForPermission(
    userId,
    PERMISSIONS.VIEW_LOCATION,
  );

  return {
    location: ping,
    status: summary.status,
    statusReason: summary.reason,
    insideZones: summary.insideZones.map((z) => ({ zoneId: z.zoneId, zoneName: z.zoneName })),
    zones,
    zoneStates,
    gps: { isStale: gps.isLost, silentSeconds: gps.silentSeconds },
    sharing: {
      enabled: settings?.locationSharingEnabled ?? true,
      // بنر «چه کسانی شما را می‌بینند» از همین می‌آید
      viewerCount: settings?.locationSharingEnabled ? viewers.length : 0,
      viewers: settings?.locationSharingEnabled ? viewers : [],
    },
    batteryLevel: ping?.batteryLevel ?? null,
  };
}

export default {
  ingestPing,
  getCurrentLocation,
  getWatchList,
  getHistory,
  getHistoryDays,
  deleteHistory,
  setLocationSharing,
  getOwnStatus,
  assertCanViewLocation,
};
