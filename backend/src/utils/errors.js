/**
 * خطاهای دامنه‌ای با کد وضعیت HTTP و پیام فارسی.
 * کنترلرها فقط throw می‌کنند؛ میان‌افزار خطا مسئول تبدیل آن به پاسخ HTTP است.
 */

export class AppError extends Error {
  /**
   * @param {number} status کد وضعیت HTTP
   * @param {string} code شناسه‌ی ماشین‌خوان خطا (برای کلاینت)
   * @param {string} message پیام فارسی قابل نمایش به کاربر
   * @param {object} [details] جزئیات اضافی (مثلاً خطاهای اعتبارسنجی فیلدها)
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expected = true; // خطای پیش‌بینی‌شده است، نه باگ
    if (Error.captureStackTrace) Error.captureStackTrace(this, AppError);
  }
}

export const badRequest = (message = 'درخواست نامعتبر است.', details) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'برای این کار باید وارد حساب خود شوید.') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'شما به این بخش دسترسی ندارید.') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'موردی که دنبالش بودید پیدا نشد.') =>
  new AppError(404, 'NOT_FOUND', message);

export const conflict = (message = 'این مورد از قبل وجود دارد.') =>
  new AppError(409, 'CONFLICT', message);

export const tooManyRequests = (
  message = 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.',
) => new AppError(429, 'TOO_MANY_REQUESTS', message);

export const internal = (message = 'خطای غیرمنتظره‌ای رخ داد.') =>
  new AppError(500, 'INTERNAL_ERROR', message);
