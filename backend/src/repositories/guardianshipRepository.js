/**
 * مخزن رابطه‌ی سرپرستی و کدهای دعوت.
 *
 * نکته‌ی امنیتی: کوئری‌های این ماژول همیشه شرط ‎status = 'active' را دارند.
 * «قطع دسترسی» در این سیستم یعنی رابطه revoked شود و از همان لحظه هیچ
 * کوئری‌ای آن را برنگرداند — نه اینکه فقط در رابط کاربری مخفی شود.
 */
import db from '../db/index.js';
import { mapGuardianship, mapInvite } from './mappers.js';

/* ───────────────────────────── سرپرستی ───────────────────────────── */

export async function findById(id) {
  const { rows } = await db.query('SELECT * FROM guardianships WHERE id = $1', [id]);
  return mapGuardianship(rows[0]);
}

export async function findBetween(primaryUserId, guardianUserId) {
  const { rows } = await db.query(
    'SELECT * FROM guardianships WHERE primary_user_id = $1 AND guardian_user_id = $2',
    [primaryUserId, guardianUserId],
  );
  return mapGuardianship(rows[0]);
}

/** اعضای خانواده‌ای که به یک کاربر اصلی دسترسی دارند. */
export async function listGuardiansOf(primaryUserId, { includeRevoked = false } = {}) {
  const { rows } = await db.query(
    `SELECT g.*,
            u.full_name    AS guardian_name,
            u.phone        AS guardian_phone,
            u.avatar_color AS guardian_avatar_color
     FROM guardianships g
     JOIN users u ON u.id = g.guardian_user_id
     WHERE g.primary_user_id = $1
       AND ($2::boolean OR g.status = 'active')
     ORDER BY g.created_at DESC`,
    [primaryUserId, includeRevoked],
  );
  return rows.map(mapGuardianship);
}

/** کاربران اصلی‌ای که یک عضو خانواده به آن‌ها دسترسی دارد. */
export async function listPrimariesFor(guardianUserId, { includeRevoked = false } = {}) {
  const { rows } = await db.query(
    `SELECT g.*,
            u.full_name    AS primary_name,
            u.phone        AS primary_phone,
            u.avatar_color AS primary_avatar_color
     FROM guardianships g
     JOIN users u ON u.id = g.primary_user_id
     WHERE g.guardian_user_id = $1
       AND ($2::boolean OR g.status = 'active')
     ORDER BY g.created_at DESC`,
    [guardianUserId, includeRevoked],
  );
  return rows.map(mapGuardianship);
}

/**
 * بررسی اینکه یک عضو خانواده، سطح دسترسی مشخصی روی یک کاربر اصلی دارد یا نه.
 * این تابع قلب کنترل دسترسی سطح‌رکورد است و در میان‌افزار مجوزها استفاده می‌شود.
 */
export async function hasPermission(primaryUserId, guardianUserId, permission) {
  const { rows } = await db.query(
    `SELECT 1 FROM guardianships
     WHERE primary_user_id = $1
       AND guardian_user_id = $2
       AND status = 'active'
       AND $3 = ANY(permissions)`,
    [primaryUserId, guardianUserId, permission],
  );
  return rows.length > 0;
}

/**
 * فهرست اعضای خانواده‌ای که باید یک نوع هشدار را دریافت کنند.
 * توزیع هشدار دقیقاً از همین کوئری تغذیه می‌شود، پس فیلترِ دسترسی
 * در همان لایه‌ی داده اعمال می‌شود و امکان فراموش‌شدنش در کد بالاتر نیست.
 */
export async function listRecipientsForPermission(primaryUserId, permission) {
  const { rows } = await db.query(
    `SELECT g.guardian_user_id AS id, u.full_name, u.avatar_color
     FROM guardianships g
     JOIN users u ON u.id = g.guardian_user_id
     WHERE g.primary_user_id = $1
       AND g.status = 'active'
       AND $2 = ANY(g.permissions)`,
    [primaryUserId, permission],
  );
  return rows.map((r) => ({ id: r.id, fullName: r.full_name, avatarColor: r.avatar_color }));
}

/**
 * ساخت یا احیای رابطه.
 * اگر رابطه‌ای که قبلاً قطع شده دوباره برقرار شود، همان ردیف به‌روزرسانی می‌گردد
 * تا قید یکتایی نشکند و تاریخچه‌ی رابطه هم حفظ شود.
 */
export async function upsert({ primaryUserId, guardianUserId, permissions, nickname }) {
  const { rows } = await db.query(
    `INSERT INTO guardianships (primary_user_id, guardian_user_id, permissions, nickname)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (primary_user_id, guardian_user_id) DO UPDATE SET
       permissions = EXCLUDED.permissions,
       nickname    = COALESCE(EXCLUDED.nickname, guardianships.nickname),
       status      = 'active',
       revoked_at  = NULL,
       created_at  = now()
     RETURNING *`,
    [primaryUserId, guardianUserId, permissions, nickname ?? null],
  );
  return mapGuardianship(rows[0]);
}

export async function updatePermissions(id, permissions) {
  const { rows } = await db.query(
    `UPDATE guardianships SET permissions = $2
     WHERE id = $1 AND status = 'active'
     RETURNING *`,
    [id, permissions],
  );
  return mapGuardianship(rows[0]);
}

export async function revoke(id) {
  const { rows } = await db.query(
    `UPDATE guardianships SET status = 'revoked', revoked_at = now()
     WHERE id = $1 AND status = 'active'
     RETURNING *`,
    [id],
  );
  return mapGuardianship(rows[0]);
}

/* ───────────────────────────── کدهای دعوت ───────────────────────────── */

export async function createInvite({ primaryUserId, codeHash, permissions, expiresAt }) {
  const { rows } = await db.query(
    `INSERT INTO invite_codes (primary_user_id, code_hash, permissions, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [primaryUserId, codeHash, permissions, expiresAt],
  );
  return mapInvite(rows[0]);
}

/**
 * یافتن کد دعوتِ قابل استفاده.
 * سه شرطِ «مصرف‌نشده»، «منقضی‌نشده» و «هش منطبق» همگی در SQL اعمال می‌شوند
 * تا امکان دور زدنشان در کد بالاتر وجود نداشته باشد.
 */
export async function findUsableInviteByHash(codeHash) {
  const { rows } = await db.query(
    `SELECT * FROM invite_codes
     WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [codeHash],
  );
  if (!rows[0]) return null;
  return { ...mapInvite(rows[0]), primaryUserId: rows[0].primary_user_id };
}

/**
 * مصرف کد به‌صورت اتمیک.
 * شرط ‎used_at IS NULL درون خودِ UPDATE است، پس اگر دو نفر همزمان یک کد را
 * وارد کنند فقط یکی موفق می‌شود — بدون نیاز به قفل صریح.
 */
export async function markInviteUsed(inviteId, usedByUserId) {
  const { rows } = await db.query(
    `UPDATE invite_codes SET used_at = now(), used_by_user_id = $2
     WHERE id = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING *`,
    [inviteId, usedByUserId],
  );
  return rows[0] ? mapInvite(rows[0]) : null;
}

export async function listInvites(primaryUserId, { onlyActive = true } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM invite_codes
     WHERE primary_user_id = $1
       AND ($2::boolean = FALSE OR (used_at IS NULL AND expires_at > now()))
     ORDER BY created_at DESC
     LIMIT 50`,
    [primaryUserId, onlyActive],
  );
  return rows.map(mapInvite);
}

export async function deleteInvite(id, primaryUserId) {
  const { rowCount } = await db.query(
    'DELETE FROM invite_codes WHERE id = $1 AND primary_user_id = $2',
    [id, primaryUserId],
  );
  return rowCount > 0;
}

/** حذف کدهای منقضی یا مصرف‌شده‌ی قدیمی. */
export async function purgeStaleInvites() {
  const { rowCount } = await db.query(
    `DELETE FROM invite_codes
     WHERE expires_at < now() - INTERVAL '1 day'
        OR used_at   < now() - INTERVAL '7 days'`,
  );
  return rowCount;
}
