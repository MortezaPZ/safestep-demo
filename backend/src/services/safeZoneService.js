/**
 * سرویس محدوده‌های امن.
 *
 * نکته‌ی مهم: هر تغییر در محدوده (شعاع، مرکز، فعال/غیرفعال) وضعیت
 * ماشین حالتِ هیسترزیس آن محدوده را بی‌اعتبار می‌کند. اگر وضعیت قبلی
 * پاک نشود، کاربری که «داخل» بوده و حالا شعاع محدوده نصف شده، بدون
 * اینکه یک قدم برداشته باشد ناگهان هشدار خروج می‌گیرد.
 */
import * as safeZoneRepository from '../repositories/safeZoneRepository.js';
import * as locationRepository from '../repositories/locationRepository.js';
import db from '../db/index.js';
import { haversineDistance } from '../utils/geo.js';
import { thresholdsFor } from './geofenceEngine.js';
import env from '../config/env.js';
import { badRequest, notFound } from '../utils/errors.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'safe-zone' });

/** سقف تعداد محدوده برای هر کاربر — جلوی سوءاستفاده و شلوغی نقشه را می‌گیرد. */
const MAX_ZONES_PER_USER = 20;

const geofenceConfig = {
  hysteresisM: env.geofence.hysteresisM,
  debounceCount: env.geofence.debounceCount,
  cooldownSec: env.geofence.cooldownSec,
};

/** افزودن اطلاعات محاسباتی مفید برای نمایش در رابط کاربری. */
function decorate(zone, currentLocation) {
  const thresholds = thresholdsFor(zone.radiusM, geofenceConfig);

  const distanceM = currentLocation
    ? haversineDistance(currentLocation.lat, currentLocation.lng, zone.centerLat, zone.centerLng)
    : null;

  return {
    ...zone,
    thresholds: {
      exitThresholdM: Math.round(thresholds.exitThresholdM),
      enterThresholdM: Math.round(thresholds.enterThresholdM),
      hysteresisM: Math.round(thresholds.effectiveHysteresisM),
    },
    ...(distanceM !== null ? { currentDistanceM: Math.round(distanceM) } : {}),
  };
}

export async function list(userId) {
  const [zones, current] = await Promise.all([
    safeZoneRepository.listByUser(userId),
    locationRepository.findLatest(userId),
  ]);

  return zones.map((z) => decorate(z, current));
}

export async function create(userId, data) {
  const count = await safeZoneRepository.countByUser(userId);
  if (count >= MAX_ZONES_PER_USER) {
    throw badRequest(`حداکثر ${MAX_ZONES_PER_USER} محدوده‌ی امن می‌توانید داشته باشید.`);
  }

  const zone = await safeZoneRepository.create({ userId, ...data });
  const current = await locationRepository.findLatest(userId);

  log.info('محدوده‌ی امن ساخته شد', { zoneId: zone.id, userId, radiusM: zone.radiusM });

  return decorate(zone, current);
}

export async function update(zoneId, userId, patch) {
  const existing = await safeZoneRepository.findById(zoneId);
  if (!existing || existing.userId !== userId) throw notFound('محدوده‌ی امن یافت نشد.');

  const zone = await safeZoneRepository.update(zoneId, userId, patch);
  if (!zone) throw notFound('محدوده‌ی امن یافت نشد.');

  // اگر هندسه یا وضعیت فعال بودن تغییر کرده، ماشین حالت باید از نو ارزیابی شود
  const geometryChanged =
    patch.centerLat !== undefined ||
    patch.centerLng !== undefined ||
    patch.radiusM !== undefined ||
    patch.isActive !== undefined;

  if (geometryChanged) {
    await db.query('DELETE FROM zone_states WHERE zone_id = $1 AND user_id = $2', [zoneId, userId]);
    log.debug('وضعیت هیسترزیس محدوده بازنشانی شد', { zoneId });
  }

  const current = await locationRepository.findLatest(userId);
  return decorate(zone, current);
}

export async function remove(zoneId, userId) {
  const removed = await safeZoneRepository.remove(zoneId, userId);
  if (!removed) throw notFound('محدوده‌ی امن یافت نشد.');

  log.info('محدوده‌ی امن حذف شد', { zoneId, userId });
  return { ok: true };
}

/**
 * پیش‌نمایش یک محدوده پیش از ذخیره.
 * صفحه‌ی ساخت محدوده از این استفاده می‌کند تا هنگام کشیدن اسلایدر شعاع،
 * کاربر بلافاصله ببیند «همین حالا داخل هستی یا بیرون» — بدون ذخیره کردن.
 */
export async function preview(userId, { centerLat, centerLng, radiusM }) {
  const current = await locationRepository.findLatest(userId);
  const thresholds = thresholdsFor(radiusM, geofenceConfig);

  if (!current) {
    return {
      thresholds,
      currentDistanceM: null,
      wouldBeInside: null,
      note: 'هنوز موقعیتی ثبت نشده است.',
    };
  }

  const distanceM = haversineDistance(current.lat, current.lng, centerLat, centerLng);

  return {
    thresholds: {
      exitThresholdM: Math.round(thresholds.exitThresholdM),
      enterThresholdM: Math.round(thresholds.enterThresholdM),
      hysteresisM: Math.round(thresholds.effectiveHysteresisM),
    },
    currentDistanceM: Math.round(distanceM),
    wouldBeInside: distanceM < radiusM,
  };
}

export default { list, create, update, remove, preview, MAX_ZONES_PER_USER };
