/**
 * شبیه‌ساز موقعیت — «حالت نمایش».
 *
 * ── چرا وجود دارد و چرا صادقانه برچسب می‌خورد ────────────────────────────
 * برای نمایش سیستم در یک جلسه‌ی سه دقیقه‌ای نمی‌توان کسی را واقعاً در خیابان
 * راه برد. این ماژول یک مسیر واقعی روی نقشه‌ی تهران را با سرعت پیاده‌روی
 * پخش می‌کند و همان مسیرِ ورودیِ API واقعی را طی می‌کند: پینگ‌ها از همان
 * ‎locationService.ingestPing عبور می‌کنند، همان موتور Geofence رویشان اجرا
 * می‌شود و همان هشدارها را تولید می‌کنند.
 *
 * تنها تفاوت با موقعیت واقعی، منبع مختصات است — و همین تفاوت با پرچم
 * ‎is_simulated روی تک‌تک پینگ‌ها در دیتابیس ثبت و در رابط کاربری نمایش
 * داده می‌شود. هیچ‌جای این سیستم وانمود نمی‌کند داده‌ی شبیه‌سازی‌شده واقعی است.
 *
 * ── مدل مسیر ─────────────────────────────────────────────────────────────
 * مسیرها به‌صورت دنباله‌ای از «قطعه‌ها» (زاویه و فاصله از نقطه‌ی مبدأ)
 * تعریف شده‌اند، نه مختصات ثابت. بنابراین هر مسیر نسبت به خانه‌ی هر کاربر
 * ساخته می‌شود و رابطه‌ی هندسی‌اش با محدوده‌ی امن همیشه درست است —
 * چه خانه در تهران باشد چه هر جای دیگر.
 */
import env from '../config/env.js';
import { destinationPoint, haversineDistance, interpolate } from '../utils/geo.js';
import * as safeZoneRepository from '../repositories/safeZoneRepository.js';
import * as locationRepository from '../repositories/locationRepository.js';
import { ingestPing } from './locationService.js';
import hub from '../realtime/hub.js';
import { WS_EVENTS } from '../config/constants.js';
import { badRequest, notFound } from '../utils/errors.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'simulator' });

/** سرعت پیاده‌روی معمول یک فرد بزرگسال، بر حسب متر بر ثانیه. */
const WALKING_SPEED_MPS = 1.3;

/** دامنه‌ی نویز مصنوعی GPS بر حسب متر — بدون آن، مسیر غیرواقعی صاف می‌شود. */
const GPS_NOISE_M = 6;

/**
 * تعریف مسیرها.
 * هر قطعه: زاویه‌ی حرکت (درجه، ۰ = شمال) و فاصله (متر).
 * قطعه‌ای با ‎pauseSeconds یعنی توقف در همان نقطه.
 */
export const ROUTES = Object.freeze({
  neighborhood: {
    id: 'neighborhood',
    name: 'گشت محله',
    description: 'یک دور کوتاه در اطراف خانه — کاربر داخل محدوده‌ی امن می‌ماند.',
    expectedOutcome: 'هیچ هشداری تولید نمی‌شود.',
    legs: [
      { bearing: 45, distanceM: 90 },
      { bearing: 135, distanceM: 80 },
      { bearing: 225, distanceM: 90 },
      { bearing: 315, distanceM: 80 },
    ],
    loop: true,
  },

  exitZone: {
    id: 'exitZone',
    name: 'خروج از محدوده',
    description: 'کاربر از خانه بیرون می‌رود و از محدوده‌ی امن خارج می‌شود.',
    expectedOutcome: 'هشدار «خروج از محدوده‌ی امن» پس از تأیید debounce صادر می‌شود.',
    legs: [
      { bearing: 90, distanceM: 60 },
      { bearing: 90, distanceM: 120 },
      // عبور از باند هیسترزیس و خروج قطعی
      { bearing: 90, distanceM: 250 },
      { bearing: 60, distanceM: 200 },
      { bearing: 60, distanceM: 150 },
    ],
    loop: false,
  },

  parkStop: {
    id: 'parkStop',
    name: 'رفتن به پارک و توقف',
    description: 'کاربر تا پارک نزدیک می‌رود و مدتی همان‌جا می‌ماند.',
    expectedOutcome: 'ابتدا هشدار خروج، سپس در صورت ادامه، هشدار «توقف طولانی».',
    legs: [
      { bearing: 180, distanceM: 150 },
      { bearing: 180, distanceM: 250 },
      { bearing: 150, distanceM: 100 },
      // نشستن روی نیمکت: جابه‌جایی ناچیز، فقط نویز GPS
      { bearing: 0, distanceM: 0, pauseSeconds: 1800 },
    ],
    loop: false,
  },

  returnHome: {
    id: 'returnHome',
    name: 'بازگشت به خانه',
    description: 'کاربر از بیرون به سمت خانه برمی‌گردد.',
    expectedOutcome: 'هشدار «بازگشت به محدوده‌ی امن» صادر می‌شود.',
    legs: [
      { bearing: 270, distanceM: 300 },
      { bearing: 270, distanceM: 250 },
      { bearing: 250, distanceM: 150 },
    ],
    loop: false,
    /** این مسیر از بیرونِ محدوده شروع می‌شود. */
    startOffset: { bearing: 90, distanceM: 700 },
  },
});

/* ─────────────────────── ساخت نقاط مسیر ─────────────────────── */

/**
 * تبدیل تعریف مسیر به دنباله‌ای از نقاط با فاصله‌ی ثابتِ زمانی.
 *
 * @param {object} route
 * @param {{lat:number,lng:number}} origin نقطه‌ی مبدأ (معمولاً مرکز محدوده‌ی خانه)
 * @param {number} tickSeconds فاصله‌ی زمانی بین پینگ‌ها
 * @param {number} speedMultiplier ضریب سرعت (برای دمو معمولاً بیش از ۱)
 */
export function buildRoutePoints(route, origin, tickSeconds, speedMultiplier = 1) {
  const metersPerTick = WALKING_SPEED_MPS * speedMultiplier * tickSeconds;
  const points = [];

  let cursor = route.startOffset
    ? destinationPoint(origin.lat, origin.lng, route.startOffset.distanceM, route.startOffset.bearing)
    : { ...origin };

  points.push({ ...cursor, isPause: false });

  for (const leg of route.legs) {
    if (leg.pauseSeconds && leg.distanceM === 0) {
      // توقف: به تعداد لازم، همان نقطه تکرار می‌شود تا تشخیص توقف فعال شود
      const pauseTicks = Math.ceil(leg.pauseSeconds / tickSeconds);
      for (let i = 0; i < pauseTicks; i += 1) {
        points.push({ ...cursor, isPause: true });
      }
      continue;
    }

    const target = destinationPoint(cursor.lat, cursor.lng, leg.distanceM, leg.bearing);
    const steps = Math.max(1, Math.ceil(leg.distanceM / metersPerTick));

    for (let i = 1; i <= steps; i += 1) {
      points.push({ ...interpolate(cursor, target, i / steps), isPause: false });
    }

    cursor = target;
  }

  return points;
}

/** افزودن نویز کوچک و واقع‌گرایانه به مختصات. */
function addNoise(point) {
  const angle = Math.random() * 360;
  const distance = Math.random() * GPS_NOISE_M;
  return destinationPoint(point.lat, point.lng, distance, angle);
}

/* ─────────────────────── مدیریت نشست‌های شبیه‌سازی ─────────────────────── */

/** @type {Map<string, {timer: NodeJS.Timeout, state: object}>} */
const sessions = new Map();

function assertDemoEnabled() {
  if (!env.demo.enabled) {
    throw badRequest('حالت نمایش در این محیط غیرفعال است.');
  }
}

/** وضعیت عمومی یک نشست برای ارسال به کلاینت. */
function publicState(session) {
  if (!session) return { running: false };
  const { state } = session;
  return {
    running: true,
    routeId: state.routeId,
    routeName: ROUTES[state.routeId].name,
    index: state.index,
    total: state.points.length,
    progress: Number(((state.index / state.points.length) * 100).toFixed(1)),
    speedMultiplier: state.speedMultiplier,
    tickMs: state.tickMs,
    startedAt: state.startedAt,
    pingsSent: state.pingsSent,
    isSimulated: true,
  };
}

function broadcastStatus(userId) {
  hub.emitToUser(userId, WS_EVENTS.SIMULATOR_STATUS, publicState(sessions.get(userId)));
}

/**
 * شروع شبیه‌سازی برای یک کاربر.
 *
 * @param {string} userId
 * @param {object} options
 * @param {string} options.routeId
 * @param {number} [options.speedMultiplier] چند برابر سرعت پیاده‌روی
 * @param {number} [options.batteryLevel]
 */
export async function start(userId, { routeId, speedMultiplier = 8, batteryLevel = 78 }) {
  assertDemoEnabled();

  const route = ROUTES[routeId];
  if (!route) throw notFound(`مسیر «${routeId}» تعریف نشده است.`);

  if (speedMultiplier < 1 || speedMultiplier > 40) {
    throw badRequest('ضریب سرعت باید بین ۱ تا ۴۰ باشد.');
  }

  // مبدأ: مرکز اولین محدوده‌ی فعال کاربر، وگرنه آخرین موقعیت ثبت‌شده
  const zones = await safeZoneRepository.listByUser(userId, { onlyActive: true });
  let origin;

  if (zones.length > 0) {
    origin = { lat: zones[0].centerLat, lng: zones[0].centerLng };
  } else {
    const last = await locationRepository.findLatest(userId);
    if (!last) {
      throw badRequest(
        'برای شروع شبیه‌سازی، ابتدا یک محدوده‌ی امن بسازید یا یک موقعیت ثبت کنید.',
      );
    }
    origin = { lat: last.lat, lng: last.lng };
  }

  stop(userId); // نشست قبلی، اگر بود، متوقف می‌شود

  const tickMs = env.demo.tickMs;
  const points = buildRoutePoints(route, origin, tickMs / 1000, speedMultiplier);

  const state = {
    routeId,
    points,
    index: 0,
    speedMultiplier,
    tickMs,
    batteryLevel,
    startedAt: new Date().toISOString(),
    pingsSent: 0,
    origin,
  };

  const timer = setInterval(async () => {
    const session = sessions.get(userId);
    if (!session) return;

    const { state: s } = session;

    if (s.index >= s.points.length) {
      if (route.loop) {
        s.index = 0;
      } else {
        log.info('مسیر شبیه‌سازی به پایان رسید', { userId, routeId });
        stop(userId);
        return;
      }
    }

    const raw = s.points[s.index];
    const noisy = addNoise(raw);
    const previous = s.index > 0 ? s.points[s.index - 1] : raw;
    const stepDistance = haversineDistance(previous.lat, previous.lng, raw.lat, raw.lng);

    s.index += 1;
    s.pingsSent += 1;

    // باتری به‌آرامی کم می‌شود تا رفتار واقعی دستگاه شبیه‌سازی شود
    if (s.pingsSent % 25 === 0 && s.batteryLevel > 5) s.batteryLevel -= 1;

    try {
      await ingestPing(userId, {
        lat: noisy.lat,
        lng: noisy.lng,
        accuracyM: 5 + Math.random() * 8,
        speedMps: raw.isPause ? 0 : stepDistance / (s.tickMs / 1000),
        batteryLevel: s.batteryLevel,
        isSimulated: true, // برچسب صریح، تا سطح دیتابیس
        recordedAt: new Date(),
      });
    } catch (error) {
      log.error('ارسال پینگ شبیه‌سازی‌شده شکست خورد', { userId, error: error.message });
    }

    broadcastStatus(userId);
  }, tickMs);

  // نگذاریم تایمر شبیه‌ساز مانع خاموش شدن پردازه شود
  if (typeof timer.unref === 'function') timer.unref();

  sessions.set(userId, { timer, state });

  log.info('شبیه‌سازی موقعیت آغاز شد', {
    userId,
    routeId,
    points: points.length,
    speedMultiplier,
  });

  broadcastStatus(userId);
  return publicState(sessions.get(userId));
}

/** توقف شبیه‌سازی. */
export function stop(userId) {
  const session = sessions.get(userId);
  if (!session) return { running: false };

  clearInterval(session.timer);
  sessions.delete(userId);

  log.info('شبیه‌سازی متوقف شد', { userId, pingsSent: session.state.pingsSent });

  hub.emitToUser(userId, WS_EVENTS.SIMULATOR_STATUS, { running: false });
  return { running: false, pingsSent: session.state.pingsSent };
}

export function status(userId) {
  return publicState(sessions.get(userId));
}

/** فهرست مسیرهای موجود — برای انتخابگر در پنل حالت نمایش. */
export function listRoutes() {
  return Object.values(ROUTES).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    expectedOutcome: r.expectedOutcome,
    legCount: r.legs.length,
    loop: r.loop,
  }));
}

/** توقف همه‌ی نشست‌ها — هنگام خاموش شدن سرور. */
export function stopAll() {
  for (const userId of [...sessions.keys()]) stop(userId);
}

export default { start, stop, status, listRoutes, stopAll, buildRoutePoints, ROUTES };
