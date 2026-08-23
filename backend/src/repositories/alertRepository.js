/**
 * مخزن هشدارها و وضعیت خوانده‌شدنشان.
 */
import db from '../db/index.js';
import { mapAlert } from './mappers.js';

export async function create({ userId, type, severity, title, body, lat, lng, zoneId, metadata }) {
  const { rows } = await db.query(
    `INSERT INTO alerts (user_id, type, severity, title, body, lat, lng, zone_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::jsonb, '{}'::jsonb))
     RETURNING *`,
    [
      userId, type, severity, title, body,
      lat ?? null, lng ?? null, zoneId ?? null,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );
  return mapAlert(rows[0]);
}

export async function findById(id) {
  const { rows } = await db.query('SELECT * FROM alerts WHERE id = $1', [id]);
  return mapAlert(rows[0]);
}

/**
 * فهرست هشدارها برای مجموعه‌ای از کاربران اصلی.
 *
 * @param {string[]} subjectIds کاربرانی که بیننده اجازه‌ی دیدن هشدارهایشان را دارد
 * @param {string} viewerId بیننده — برای محاسبه‌ی وضعیت خوانده/نخوانده
 */
export async function list(subjectIds, viewerId, { types, unreadOnly = false, limit = 100, before } = {}) {
  if (!Array.isArray(subjectIds) || subjectIds.length === 0) return [];

  const { rows } = await db.query(
    `SELECT a.*,
            u.full_name    AS subject_name,
            u.avatar_color AS subject_avatar_color,
            z.name         AS zone_name,
            (r.alert_id IS NOT NULL) AS is_read
     FROM alerts a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN safe_zones z  ON z.id = a.zone_id
     LEFT JOIN alert_reads r ON r.alert_id = a.id AND r.user_id = $2
     WHERE a.user_id = ANY($1::uuid[])
       AND ($3::text[] IS NULL OR a.type = ANY($3::text[]))
       AND ($4::boolean = FALSE OR r.alert_id IS NULL)
       AND ($5::timestamptz IS NULL OR a.created_at < $5)
     ORDER BY a.created_at DESC
     LIMIT $6`,
    [subjectIds, viewerId, types ?? null, unreadOnly, before ?? null, limit],
  );
  return rows.map(mapAlert);
}

/** شمارش هشدارهای نخوانده — برای نشان (badge) روی آیکون هشدارها. */
export async function countUnread(subjectIds, viewerId) {
  if (!Array.isArray(subjectIds) || subjectIds.length === 0) return 0;
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM alerts a
     LEFT JOIN alert_reads r ON r.alert_id = a.id AND r.user_id = $2
     WHERE a.user_id = ANY($1::uuid[]) AND r.alert_id IS NULL`,
    [subjectIds, viewerId],
  );
  return rows[0]?.count ?? 0;
}

export async function markRead(alertId, userId) {
  const { rows } = await db.query(
    `INSERT INTO alert_reads (alert_id, user_id) VALUES ($1, $2)
     ON CONFLICT (alert_id, user_id) DO NOTHING
     RETURNING *`,
    [alertId, userId],
  );
  return rows.length > 0;
}

export async function markAllRead(subjectIds, viewerId) {
  if (!Array.isArray(subjectIds) || subjectIds.length === 0) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO alert_reads (alert_id, user_id)
     SELECT a.id, $2 FROM alerts a
     WHERE a.user_id = ANY($1::uuid[])
     ON CONFLICT (alert_id, user_id) DO NOTHING`,
    [subjectIds, viewerId],
  );
  return rowCount;
}

export async function resolve(alertId, resolvedBy) {
  const { rows } = await db.query(
    `UPDATE alerts SET resolved_at = now(), resolved_by = $2
     WHERE id = $1 AND resolved_at IS NULL
     RETURNING *`,
    [alertId, resolvedBy],
  );
  return mapAlert(rows[0]);
}

/**
 * آخرین هشدار از یک نوع مشخص — پایه‌ی منطق «دوره‌ی خاموشی» (cooldown).
 * بدون این، یک GPS لرزان می‌تواند ده‌ها هشدار یکسان تولید کند.
 */
export async function findLastOfType(userId, type, { zoneId } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM alerts
     WHERE user_id = $1 AND type = $2
       AND ($3::uuid IS NULL OR zone_id = $3)
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, type, zoneId ?? null],
  );
  return mapAlert(rows[0]);
}

/** آمار هشدارها به تفکیک نوع — برای چیپ‌های فیلتر در صفحه‌ی هشدارها. */
export async function countsByType(subjectIds) {
  if (!Array.isArray(subjectIds) || subjectIds.length === 0) return {};
  const { rows } = await db.query(
    `SELECT type, COUNT(*)::int AS count
     FROM alerts WHERE user_id = ANY($1::uuid[])
     GROUP BY type`,
    [subjectIds],
  );
  return Object.fromEntries(rows.map((r) => [r.type, r.count]));
}
