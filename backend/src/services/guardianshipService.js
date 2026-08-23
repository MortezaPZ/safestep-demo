/**
 * سرویس سرپرستی — ساخت و مصرف کد دعوت، مدیریت سطح دسترسی، قطع دسترسی.
 *
 * ── چرخه‌ی عمر کد دعوت ───────────────────────────────────────────────────
 *   ۱) کاربر اصلی کد می‌سازد و همان‌جا سطح دسترسی را انتخاب می‌کند
 *   ۲) کد ۶ رقمی فقط یک بار به کاربر نمایش داده می‌شود؛ در دیتابیس
 *      تنها HMAC آن ذخیره می‌شود
 *   ۳) کد پس از ۱۵ دقیقه منقضی می‌شود
 *   ۴) مصرف کد اتمیک است: از دو نفری که همزمان کد را وارد کنند، یکی موفق می‌شود
 */
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_LABELS,
  WS_EVENTS,
} from '../config/constants.js';
import * as guardianshipRepository from '../repositories/guardianshipRepository.js';
import * as userRepository from '../repositories/userRepository.js';
import { generateInviteCode, hashInviteCode } from '../utils/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import hub from '../realtime/hub.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'guardianship' });

/** مدت اعتبار کد دعوت. کوتاه بودنش عمدی است: کد باید در همان لحظه استفاده شود. */
export const INVITE_TTL_MINUTES = 15;

/** اعتبارسنجی فهرست سطوح دسترسی. */
function validatePermissions(permissions) {
  if (!Array.isArray(permissions) || permissions.length === 0) {
    throw badRequest('حداقل یک سطح دسترسی باید انتخاب شود.');
  }

  const invalid = permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
  if (invalid.length > 0) {
    throw badRequest(`سطح دسترسی نامعتبر است: ${invalid.join(', ')}`);
  }

  // دسترسی اضطراری بدون دریافت هشدار بی‌معناست: کسی که باید در لحظه‌ی
  // بحران کمک کند، باید هشدار آن بحران را هم بگیرد.
  const normalized = new Set(permissions);
  if (normalized.has(PERMISSIONS.EMERGENCY)) {
    normalized.add(PERMISSIONS.RECEIVE_ALERTS);
  }

  return [...normalized];
}

/* ─────────────────────────── کد دعوت ─────────────────────────── */

/**
 * ساخت کد دعوت.
 * @returns {Promise<{code: string, invite: object, expiresInMinutes: number}>}
 *          خودِ کد فقط همین یک بار برگردانده می‌شود.
 */
export async function createInvite(primaryUserId, permissions) {
  const validated = validatePermissions(permissions);
  const code = generateInviteCode();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MINUTES * 60_000);

  const invite = await guardianshipRepository.createInvite({
    primaryUserId,
    codeHash: hashInviteCode(code),
    permissions: validated,
    expiresAt,
  });

  log.info('کد دعوت ساخته شد', {
    inviteId: invite.id,
    primaryUserId,
    permissions: validated,
    expiresInMinutes: INVITE_TTL_MINUTES,
  });

  return {
    code, // فقط در همین پاسخ؛ در دیتابیس ذخیره نمی‌شود
    invite,
    expiresInMinutes: INVITE_TTL_MINUTES,
    permissionLabels: validated.map((p) => PERMISSION_LABELS[p]),
  };
}

export async function listInvites(primaryUserId) {
  return guardianshipRepository.listInvites(primaryUserId, { onlyActive: true });
}

export async function cancelInvite(inviteId, primaryUserId) {
  const removed = await guardianshipRepository.deleteInvite(inviteId, primaryUserId);
  if (!removed) throw notFound('کد دعوت یافت نشد.');
  return { ok: true };
}

/**
 * مصرف کد دعوت توسط عضو خانواده.
 * تمام شرط‌های امنیتی (انقضا، یک‌بارمصرف بودن، تطبیق هش) در لایه‌ی دیتابیس
 * اعمال می‌شوند، نه اینجا.
 */
export async function redeemInvite(code, guardianUserId) {
  const normalizedCode = String(code)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/\D/g, '');

  if (normalizedCode.length !== 6) {
    throw badRequest('کد دعوت باید ۶ رقم باشد.');
  }

  const invite = await guardianshipRepository.findUsableInviteByHash(
    hashInviteCode(normalizedCode),
  );

  // پیام یکسان برای «کد اشتباه»، «کد منقضی» و «کد مصرف‌شده» تا نتوان
  // با آزمون‌وخطا فهمید کدام کدها زمانی معتبر بوده‌اند.
  if (!invite) {
    throw badRequest('کد دعوت نامعتبر یا منقضی شده است.');
  }

  if (invite.primaryUserId === guardianUserId) {
    throw badRequest('نمی‌توانید کد دعوت خودتان را استفاده کنید.');
  }

  const existing = await guardianshipRepository.findBetween(invite.primaryUserId, guardianUserId);
  if (existing && existing.status === 'active') {
    throw conflict('شما از قبل به این کاربر دسترسی دارید.');
  }

  // مصرف اتمیک؛ اگر کسی زودتر رسیده باشد، اینجا null برمی‌گردد
  const consumed = await guardianshipRepository.markInviteUsed(invite.id, guardianUserId);
  if (!consumed) {
    throw badRequest('این کد همین حالا توسط شخص دیگری استفاده شد.');
  }

  const guardianship = await guardianshipRepository.upsert({
    primaryUserId: invite.primaryUserId,
    guardianUserId,
    permissions: invite.permissions,
  });

  const [primaryUser, guardianUser] = await Promise.all([
    userRepository.findById(invite.primaryUserId),
    userRepository.findById(guardianUserId),
  ]);

  // هر دو طرف بلافاصله مطلع می‌شوند — کاربر اصلی باید بداند چه کسی
  // همین حالا به موقعیتش دسترسی پیدا کرد.
  hub.emitToUsers([invite.primaryUserId, guardianUserId], WS_EVENTS.PRESENCE, {
    type: 'guardianship_created',
    guardianship: { ...guardianship, primaryUser, guardianUser },
    at: new Date().toISOString(),
  });

  log.info('کد دعوت مصرف شد', {
    guardianshipId: guardianship.id,
    primaryUserId: invite.primaryUserId,
    guardianUserId,
  });

  return { guardianship: { ...guardianship, primaryUser, guardianUser } };
}

/* ─────────────────────────── مدیریت رابطه ─────────────────────────── */

export async function listMyGuardians(primaryUserId) {
  const guardians = await guardianshipRepository.listGuardiansOf(primaryUserId);
  return guardians.map((g) => ({
    ...g,
    permissionLabels: g.permissions.map((p) => PERMISSION_LABELS[p]).filter(Boolean),
    isOnline: hub.isUserOnline(g.guardianUserId),
  }));
}

export async function listMyPrimaries(guardianUserId) {
  const primaries = await guardianshipRepository.listPrimariesFor(guardianUserId);
  return primaries.map((g) => ({
    ...g,
    permissionLabels: g.permissions.map((p) => PERMISSION_LABELS[p]).filter(Boolean),
    isOnline: hub.isUserOnline(g.primaryUserId),
  }));
}

/** هر دو جهت رابطه — برای صفحه‌ی «اعضای خانواده». */
export async function listAll(userId) {
  const [guardians, primaries] = await Promise.all([
    listMyGuardians(userId),
    listMyPrimaries(userId),
  ]);
  return { guardians, primaries };
}

/**
 * تغییر سطح دسترسی. فقط کاربر اصلی می‌تواند این کار را بکند —
 * عضو خانواده نمی‌تواند دسترسی خودش را ارتقا دهد.
 */
export async function updatePermissions(guardianshipId, primaryUserId, permissions) {
  const existing = await guardianshipRepository.findById(guardianshipId);
  if (!existing) throw notFound('رابطه یافت نشد.');

  if (existing.primaryUserId !== primaryUserId) {
    throw forbidden('فقط کاربر اصلی می‌تواند سطح دسترسی را تغییر دهد.');
  }

  const validated = validatePermissions(permissions);
  const updated = await guardianshipRepository.updatePermissions(guardianshipId, validated);
  if (!updated) throw notFound('رابطه‌ی فعالی برای به‌روزرسانی یافت نشد.');

  hub.emitToUsers([primaryUserId, existing.guardianUserId], WS_EVENTS.PRESENCE, {
    type: 'permissions_changed',
    guardianshipId,
    permissions: validated,
    at: new Date().toISOString(),
  });

  log.info('سطح دسترسی تغییر کرد', { guardianshipId, permissions: validated });

  return {
    ...updated,
    permissionLabels: validated.map((p) => PERMISSION_LABELS[p]),
  };
}

/**
 * قطع دسترسی.
 * هر دو طرف می‌توانند رابطه را قطع کنند: کاربر اصلی برای پس گرفتن دسترسی،
 * و عضو خانواده برای کنار گذاشتن مسئولیت.
 */
export async function revoke(guardianshipId, requesterId) {
  const existing = await guardianshipRepository.findById(guardianshipId);
  if (!existing) throw notFound('رابطه یافت نشد.');

  const isParty =
    existing.primaryUserId === requesterId || existing.guardianUserId === requesterId;
  if (!isParty) throw forbidden('شما طرف این رابطه نیستید.');

  const revoked = await guardianshipRepository.revoke(guardianshipId);
  if (!revoked) throw notFound('رابطه‌ی فعالی برای قطع کردن یافت نشد.');

  hub.emitToUsers([existing.primaryUserId, existing.guardianUserId], WS_EVENTS.PRESENCE, {
    type: 'guardianship_revoked',
    guardianshipId,
    revokedBy: requesterId,
    at: new Date().toISOString(),
  });

  log.info('دسترسی قطع شد', { guardianshipId, revokedBy: requesterId });

  return revoked;
}

export default {
  createInvite,
  listInvites,
  cancelInvite,
  redeemInvite,
  listMyGuardians,
  listMyPrimaries,
  listAll,
  updatePermissions,
  revoke,
  INVITE_TTL_MINUTES,
};
