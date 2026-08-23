/**
 * مدیریت متمرکز خطا و مسیر یافت‌نشده.
 *
 * قاعده: خطاهای پیش‌بینی‌شده (AppError) با پیام فارسی خودشان برمی‌گردند؛
 * هر خطای دیگری یک باگ است و جزئیاتش فقط در لاگ سرور می‌ماند، نه در پاسخ.
 * افشای پیام خطای داخلی به کلاینت، هم نشت اطلاعات است و هم برای کاربر بی‌معنا.
 */
import env from '../config/env.js';
import { AppError, notFound } from '../utils/errors.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'http' });

/** مسیرهای تعریف‌نشده. */
export function notFoundHandler(req, _res, next) {
  next(notFound(`مسیر «${req.method} ${req.path}» وجود ندارد.`));
}

/** میان‌افزار نهایی خطا. باید آخرین میان‌افزار ثبت‌شده باشد. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, _next) {
  // خطای JSON نامعتبر که body-parser تولید می‌کند
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'قالب داده‌ی ارسالی معتبر نیست.' },
    });
  }

  if (error instanceof AppError) {
    if (error.status >= 500) {
      log.error('خطای سرور', { code: error.code, message: error.message, path: req.path });
    } else {
      log.debug('خطای کاربر', { code: error.code, status: error.status, path: req.path });
    }

    return res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }

  // از اینجا به بعد یعنی باگ
  log.error('خطای مدیریت‌نشده', {
    message: error.message,
    path: req.path,
    method: req.method,
    stack: env.isProduction ? undefined : error.stack,
  });

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'خطای غیرمنتظره‌ای رخ داد. لطفاً دوباره تلاش کنید.',
      // جزئیات فنی فقط در محیط توسعه
      ...(env.isProduction ? {} : { debug: error.message }),
    },
  });
}

/**
 * پوشش کنترلرهای async تا خطاهایشان به میان‌افزار خطا برسد.
 * بدون این، یک Promise رد شده در Express به پاسخ ۵۰۰ تبدیل نمی‌شود و
 * درخواست تا زمان timeout معلق می‌ماند.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
