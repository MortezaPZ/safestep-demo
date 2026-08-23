/**
 * هابِ پخش زنده — واسط بین سرویس‌ها و لایه‌ی WebSocket.
 *
 * چرا یک لایه‌ی میانی وجود دارد:
 *   سرویس‌ها نباید به socket.io وابسته باشند. با این واسط، سرویس فقط می‌گوید
 *   «این رویداد را به این کاربران برسان» و اصلاً نمی‌داند تحویل با WebSocket
 *   انجام می‌شود یا چیز دیگری. نتیجه: سرویس‌ها بدون بالا آوردن سرور
 *   قابل تست‌اند، و جایگزینی لایه‌ی انتقال هیچ سرویسی را دست نمی‌زند.
 */
import logger from '../utils/logger.js';

const log = logger.child({ module: 'hub' });

/** @type {{ emit: (userIds: string[], event: string, payload: any) => void } | null} */
let transport = null;

/** ثبت لایه‌ی انتقال. socket.js هنگام راه‌اندازی این را صدا می‌زند. */
export function setTransport(impl) {
  transport = impl;
}

/**
 * ارسال یک رویداد به مجموعه‌ای از کاربران.
 * اگر لایه‌ی انتقال ثبت نشده باشد (مثلاً در تست‌های واحد)، بی‌صدا رد می‌شود
 * تا منطق دامنه به وجود سرور وابسته نباشد.
 */
export function emitToUsers(userIds, event, payload) {
  const targets = [...new Set((userIds ?? []).filter(Boolean))];
  if (targets.length === 0) return;

  if (!transport) {
    log.debug('لایه‌ی انتقال ثبت نشده؛ رویداد ارسال نشد', { event, targets: targets.length });
    return;
  }

  transport.emit(targets, event, payload);
}

/** ارسال به یک کاربر. */
export function emitToUser(userId, event, payload) {
  emitToUsers([userId], event, payload);
}

/** تعداد کاربران متصل — برای ‎/health و نشانگر «آنلاین». */
export function connectedUserCount() {
  return transport?.connectedUserCount?.() ?? 0;
}

/** آیا کاربر مشخصی همین حالا اتصال زنده دارد؟ */
export function isUserOnline(userId) {
  return transport?.isUserOnline?.(userId) ?? false;
}

export default { setTransport, emitToUsers, emitToUser, connectedUserCount, isUserOnline };
