/**
 * مخزن پینگ‌های موقعیت.
 *
 * نکته‌ی حریم خصوصی: تابع ‎deleteHistory واقعاً ردیف‌ها را DELETE می‌کند،
 * نه اینکه پرچم «حذف‌شده» بزند. اگر کاربر بگوید تاریخچه‌ام پاک شود،
 * باید واقعاً پاک شود — این یکی از تعهدهای صریح محصول است.
 */
import db from '../db/index.js';
import { mapPing } from './mappers.js';

export async function insertPing({
  userId, lat, lng, accuracyM, speedMps, headingDeg, batteryLevel, isSimulated, recordedAt,
}) {
  const { rows } = await db.query(
    `INSERT INTO location_pings
       (user_id, lat, lng, accuracy_m, speed_mps, heading_deg, battery_level, is_simulated, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()))
     RETURNING *`,
    [
      userId, lat, lng,
      accuracyM ?? null, speedMps ?? null, headingDeg ?? null,
      batteryLevel ?? null, Boolean(isSimulated), recordedAt ?? null,
    ],
  );
  return mapPing(rows[0]);
}

export async function findLatest(userId) {
  const { rows } = await db.query(
    'SELECT * FROM location_pings WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT 1',
    [userId],
  );
  return mapPing(rows[0]);
}

/** آخرین موقعیت چند کاربر با یک کوئری — داشبورد عضو خانواده از این استفاده می‌کند. */
export async function findLatestForUsers(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];
  const { rows } = await db.query(
    `SELECT DISTINCT ON (user_id) *
     FROM location_pings
     WHERE user_id = ANY($1::uuid[])
     ORDER BY user_id, recorded_at DESC`,
    [userIds],
  );
  return rows.map(mapPing);
}

/**
 * تاریخچه‌ی مسیر در یک بازه.
 * سقف تعداد عمداً وجود دارد: یک روز پینگ هر ۵ ثانیه یعنی ۱۷ هزار نقطه که
 * هم پاسخ را سنگین می‌کند و هم نقشه‌ی کلاینت را از کار می‌اندازد.
 */
export async function findHistory(userId, { from, to, limit = 2000 }) {
  const { rows } = await db.query(
    `SELECT * FROM location_pings
     WHERE user_id = $1
       AND recorded_at >= $2
       AND recorded_at <= $3
     ORDER BY recorded_at ASC
     LIMIT $4`,
    [userId, from, to, limit],
  );
  return rows.map(mapPing);
}

/**
 * پینگ‌های پنجره‌ی زمانی اخیر — ورودی تشخیص توقف طولانی.
 * @param {number} windowMinutes طول پنجره بر حسب دقیقه
 */
export async function findRecentWindow(userId, windowMinutes) {
  const { rows } = await db.query(
    `SELECT * FROM location_pings
     WHERE user_id = $1
       AND recorded_at >= now() - ($2 || ' minutes')::interval
     ORDER BY recorded_at ASC`,
    [userId, String(windowMinutes)],
  );
  return rows.map(mapPing);
}

/** روزهایی که برای کاربر داده‌ی مسیر وجود دارد — برای انتخابگر روز در تاریخچه. */
export async function listHistoryDays(userId, limit = 30) {
  const { rows } = await db.query(
    `SELECT date_trunc('day', recorded_at) AS day,
            COUNT(*)::int                  AS ping_count,
            MIN(recorded_at)               AS first_at,
            MAX(recorded_at)               AS last_at,
            BOOL_OR(is_simulated)          AS has_simulated
     FROM location_pings
     WHERE user_id = $1
     GROUP BY 1
     ORDER BY 1 DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    day: new Date(r.day).toISOString(),
    pingCount: r.ping_count,
    firstAt: new Date(r.first_at).toISOString(),
    lastAt: new Date(r.last_at).toISOString(),
    hasSimulated: r.has_simulated,
  }));
}

/**
 * حذف واقعی تاریخچه. اگر بازه داده نشود، کل تاریخچه‌ی کاربر پاک می‌شود.
 * @returns {Promise<number>} تعداد ردیف‌های حذف‌شده
 */
export async function deleteHistory(userId, { from, to } = {}) {
  const { rowCount } = await db.query(
    `DELETE FROM location_pings
     WHERE user_id = $1
       AND ($2::timestamptz IS NULL OR recorded_at >= $2)
       AND ($3::timestamptz IS NULL OR recorded_at <= $3)`,
    [userId, from ?? null, to ?? null],
  );
  return rowCount;
}

/** آمار خلاصه‌ی یک روز — برای کارت بالای صفحه‌ی تاریخچه. */
export async function dayStats(userId, from, to) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int         AS ping_count,
            MIN(recorded_at)      AS first_at,
            MAX(recorded_at)      AS last_at,
            AVG(speed_mps)        AS avg_speed,
            MIN(battery_level)    AS min_battery
     FROM location_pings
     WHERE user_id = $1 AND recorded_at >= $2 AND recorded_at <= $3`,
    [userId, from, to],
  );
  const r = rows[0];
  return {
    pingCount: r?.ping_count ?? 0,
    firstAt: r?.first_at ? new Date(r.first_at).toISOString() : null,
    lastAt: r?.last_at ? new Date(r.last_at).toISOString() : null,
    avgSpeedMps: r?.avg_speed === null || r?.avg_speed === undefined ? null : Number(r.avg_speed),
    minBattery: r?.min_battery ?? null,
  };
}
