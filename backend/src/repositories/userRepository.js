/**
 * مخزن کاربران، تنظیمات و توکن‌های تازه‌سازی.
 * هیچ منطق دامنه‌ای اینجا نیست — فقط دسترسی به داده.
 */
import db from '../db/index.js';
import { mapUser, mapSettings } from './mappers.js';

/* ───────────────────────────── کاربران ───────────────────────────── */

export async function findById(id) {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return mapUser(rows[0]);
}

export async function findByPhone(phone) {
  const { rows } = await db.query('SELECT * FROM users WHERE phone = $1', [phone]);
  return mapUser(rows[0]);
}

/** برای ورود لازم است، چون تنها جایی است که به هش پسورد نیاز داریم. */
export async function findByPhoneWithSecret(phone) {
  const { rows } = await db.query('SELECT * FROM users WHERE phone = $1', [phone]);
  if (!rows[0]) return null;
  return { ...mapUser(rows[0]), passwordHash: rows[0].password_hash };
}

export async function existsByPhone(phone) {
  const { rows } = await db.query('SELECT 1 FROM users WHERE phone = $1', [phone]);
  return rows.length > 0;
}

/**
 * ساخت کاربر به‌همراه ردیف تنظیمات پیش‌فرضش، درون یک تراکنش.
 * اگر ساخت تنظیمات شکست بخورد، کاربر هم ساخته نمی‌شود — وگرنه کاربری
 * بدون تنظیمات می‌ماند که تمام کوئری‌های بعدی را می‌شکند.
 */
export async function create({ phone, passwordHash, fullName, role, avatarColor }) {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO users (phone, password_hash, full_name, role, avatar_color)
       VALUES ($1, $2, $3, $4, COALESCE($5, '#2F6FED'))
       RETURNING *`,
      [phone, passwordHash, fullName, role, avatarColor ?? null],
    );
    const user = mapUser(rows[0]);

    await tx.query('INSERT INTO user_settings (user_id) VALUES ($1)', [user.id]);

    return user;
  });
}

export async function updateProfile(id, { fullName, avatarColor, locale }) {
  const { rows } = await db.query(
    `UPDATE users SET
       full_name    = COALESCE($2, full_name),
       avatar_color = COALESCE($3, avatar_color),
       locale       = COALESCE($4, locale),
       updated_at   = now()
     WHERE id = $1
     RETURNING *`,
    [id, fullName ?? null, avatarColor ?? null, locale ?? null],
  );
  return mapUser(rows[0]);
}

/* ───────────────────────────── تنظیمات ───────────────────────────── */

export async function getSettings(userId) {
  const { rows } = await db.query('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
  return mapSettings(rows[0]);
}

export async function updateSettings(userId, patch) {
  const { rows } = await db.query(
    `UPDATE user_settings SET
       location_sharing_enabled = COALESCE($2, location_sharing_enabled),
       long_stop_minutes        = COALESCE($3, long_stop_minutes),
       long_stop_radius_m       = COALESCE($4, long_stop_radius_m),
       alert_types              = COALESCE($5, alert_types),
       theme                    = COALESCE($6, theme),
       language                 = COALESCE($7, language),
       updated_at               = now()
     WHERE user_id = $1
     RETURNING *`,
    [
      userId,
      patch.locationSharingEnabled ?? null,
      patch.longStopMinutes ?? null,
      patch.longStopRadiusM ?? null,
      patch.alertTypes ?? null,
      patch.theme ?? null,
      patch.language ?? null,
    ],
  );
  return mapSettings(rows[0]);
}

/* ──────────────────── توکن‌های تازه‌سازی (نشست‌ها) ──────────────────── */

export async function saveRefreshToken({ userId, jti, tokenHash, userAgent, expiresAt }) {
  await db.query(
    `INSERT INTO refresh_tokens (user_id, jti, token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, jti, tokenHash, userAgent ?? null, expiresAt],
  );
}

/** توکن معتبر یعنی: موجود، ابطال‌نشده و منقضی‌نشده. */
export async function findActiveRefreshToken(jti) {
  const { rows } = await db.query(
    `SELECT * FROM refresh_tokens
     WHERE jti = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [jti],
  );
  return rows[0] ?? null;
}

export async function revokeRefreshToken(jti) {
  const { rowCount } = await db.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE jti = $1 AND revoked_at IS NULL',
    [jti],
  );
  return rowCount > 0;
}

export async function revokeAllRefreshTokens(userId) {
  const { rowCount } = await db.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
  return rowCount;
}

/** پاک‌سازی نشست‌های منقضی — توسط کار زمان‌بندی‌شده‌ی نگهداری صدا زده می‌شود. */
export async function purgeExpiredRefreshTokens() {
  const { rowCount } = await db.query(
    "DELETE FROM refresh_tokens WHERE expires_at < now() - INTERVAL '7 days'",
  );
  return rowCount;
}
