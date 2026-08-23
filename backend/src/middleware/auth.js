/**
 * میان‌افزار احراز هویت و کنترل دسترسی سطح‌رکورد.
 */
import { verifyAccessToken } from '../utils/jwt.js';
import { unauthorized, forbidden } from '../utils/errors.js';
import * as guardianshipRepository from '../repositories/guardianshipRepository.js';

/**
 * الزام ورود. توکن از هدر ‎Authorization: Bearer <token> خوانده می‌شود.
 * پس از اجرا، ‎req.user شامل ‎{ id, role }‎ خواهد بود.
 */
export function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw unauthorized('برای این کار باید وارد حساب خود شوید.');
    }

    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * احراز هویت اختیاری — اگر توکن بود کاربر را می‌شناسد، اگر نبود رد نمی‌کند.
 * برای endpointهایی مثل ‎/health که پاسخشان بسته به ورود کامل‌تر می‌شود.
 */
export function optionalAuth(req, _res, next) {
  try {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');

    if (scheme === 'Bearer' && token) {
      const payload = verifyAccessToken(token);
      req.user = { id: payload.sub, role: payload.role };
    }
  } catch {
    // توکن نامعتبر در مسیر اختیاری، نادیده گرفته می‌شود
  }
  next();
}

/**
 * الزام داشتن یک سطح دسترسی مشخص روی کاربر هدف.
 *
 * شناسه‌ی کاربر هدف از پارامتر مسیر یا query خوانده می‌شود. اگر بیننده
 * خودِ کاربر هدف باشد، همیشه مجاز است.
 *
 * @param {string} permission سطح دسترسی لازم
 * @param {string} [paramName] نام پارامتر حاوی شناسه‌ی کاربر هدف
 */
export function requirePermission(permission, paramName = 'userId') {
  return async (req, _res, next) => {
    try {
      const subjectId = req.params[paramName] ?? req.query[paramName] ?? req.body?.[paramName];

      if (!subjectId) {
        throw forbidden('کاربر هدف مشخص نشده است.');
      }

      // دسترسی به داده‌ی خود، همیشه مجاز است
      if (subjectId === req.user.id) {
        req.subjectId = subjectId;
        return next();
      }

      const allowed = await guardianshipRepository.hasPermission(
        subjectId,
        req.user.id,
        permission,
      );

      if (!allowed) {
        throw forbidden('شما به داده‌های این کاربر دسترسی ندارید.');
      }

      req.subjectId = subjectId;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/** الزام نقش مشخص (مثلاً فقط کاربر اصلی). */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden('این بخش برای نقش کاربری شما در دسترس نیست.'));
    }
    return next();
  };
}
