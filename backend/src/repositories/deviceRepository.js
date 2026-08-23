/**
 * مخزن دستگاه‌ها — نگهداری توکن‌های Push و آخرین وضعیت باتری.
 */
import db from '../db/index.js';
import { mapDevice } from './mappers.js';

/**
 * ثبت یا به‌روزرسانی دستگاه.
 * کلید یکتایی روی (user_id, push_token) است، پس نصب مجدد اپ روی همان دستگاه
 * ردیف تکراری نمی‌سازد و توکن قدیمی بی‌صاحب رها نمی‌شود.
 */
export async function register({ userId, platform, pushToken, deviceName, batteryLevel }) {
  const { rows } = await db.query(
    `INSERT INTO devices (user_id, platform, push_token, device_name, battery_level)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, push_token) DO UPDATE SET
       platform      = EXCLUDED.platform,
       device_name   = COALESCE(EXCLUDED.device_name, devices.device_name),
       battery_level = COALESCE(EXCLUDED.battery_level, devices.battery_level),
       last_seen_at  = now()
     RETURNING *`,
    [userId, platform, pushToken ?? null, deviceName ?? null, batteryLevel ?? null],
  );
  return mapDevice(rows[0]);
}

export async function listByUser(userId) {
  const { rows } = await db.query(
    'SELECT * FROM devices WHERE user_id = $1 ORDER BY last_seen_at DESC',
    [userId],
  );
  return rows.map(mapDevice);
}

/** توکن‌های Push یک کاربر — ورودی آداپتور نوتیفیکیشن. */
export async function pushTokensFor(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];
  const { rows } = await db.query(
    `SELECT user_id, push_token, platform FROM devices
     WHERE user_id = ANY($1::uuid[]) AND push_token IS NOT NULL`,
    [userIds],
  );
  return rows.map((r) => ({ userId: r.user_id, token: r.push_token, platform: r.platform }));
}

/** به‌روزرسانی باتری و آخرین بازدید — همراه هر پینگ موقعیت صدا زده می‌شود. */
export async function touch(userId, { batteryLevel } = {}) {
  await db.query(
    `UPDATE devices SET
       last_seen_at  = now(),
       battery_level = COALESCE($2, battery_level)
     WHERE user_id = $1`,
    [userId, batteryLevel ?? null],
  );
}

export async function remove(id, userId) {
  const { rowCount } = await db.query('DELETE FROM devices WHERE id = $1 AND user_id = $2', [
    id,
    userId,
  ]);
  return rowCount > 0;
}
