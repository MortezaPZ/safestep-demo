/**
 * اعتبارسنجی ورودی با zod.
 *
 * هر endpoint شمای ورودی خودش را اعلام می‌کند و داده‌ی اعتبارسنجی‌شده
 * جایگزین ورودی خام می‌شود. یعنی کنترلرها هرگز با داده‌ی تأییدنشده کار
 * نمی‌کنند و لازم نیست خودشان چیزی را چک کنند.
 */
import { z } from 'zod';
import { badRequest } from '../utils/errors.js';

/** ترجمه‌ی خطاهای zod به پیام‌های فارسی قابل نمایش. */
function formatIssues(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(ریشه)',
    message: issue.message,
  }));
}

/**
 * ساخت میان‌افزار اعتبارسنجی.
 * @param {{body?: z.ZodType, query?: z.ZodType, params?: z.ZodType}} schemas
 */
export function validate(schemas) {
  return (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      if (schemas.params) req.params = schemas.params.parse(req.params ?? {});
      if (schemas.query) {
        // در Express نسخه‌ی ۵ به بعد، req.query فقط خواندنی است
        req.validatedQuery = schemas.query.parse(req.query ?? {});
        req.query = req.validatedQuery;
      }
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(badRequest('اطلاعات واردشده معتبر نیست.', formatIssues(error)));
        return;
      }
      next(error);
    }
  };
}

/* ─────────────────────── شمای‌های مشترک ─────────────────────── */

/** تبدیل ارقام فارسی/عربی به لاتین پیش از اعتبارسنجی. */
const toLatinDigits = (value) =>
  String(value)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

export const schemas = {
  uuid: z.string().uuid('شناسه معتبر نیست.'),

  phone: z
    .string()
    .transform(toLatinDigits)
    .refine((v) => /^(0|\+?98)?9\d{9}$/.test(v.replace(/\D/g, '')), {
      message: 'شماره موبایل معتبر نیست. نمونه: ۰۹۱۲۳۴۵۶۷۸۹',
    }),

  password: z
    .string()
    .min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد.')
    .max(128, 'رمز عبور بیش از حد طولانی است.'),

  fullName: z
    .string()
    .trim()
    .min(2, 'نام باید حداقل ۲ کاراکتر باشد.')
    .max(80, 'نام بیش از حد طولانی است.'),

  lat: z.number().min(-90, 'عرض جغرافیایی نامعتبر است.').max(90, 'عرض جغرافیایی نامعتبر است.'),
  lng: z.number().min(-180, 'طول جغرافیایی نامعتبر است.').max(180, 'طول جغرافیایی نامعتبر است.'),

  radiusM: z
    .number()
    .int('شعاع باید عدد صحیح باشد.')
    .min(50, 'شعاع نمی‌تواند کمتر از ۵۰ متر باشد.')
    .max(5000, 'شعاع نمی‌تواند بیشتر از ۵۰۰۰ متر باشد.'),

  inviteCode: z
    .string()
    .transform(toLatinDigits)
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v.length === 6, { message: 'کد دعوت باید ۶ رقم باشد.' }),

  permissions: z
    .array(z.enum(['view_location', 'receive_alerts', 'emergency']))
    .min(1, 'حداقل یک سطح دسترسی باید انتخاب شود.'),

  /** رشته‌ی عددی از query را به عدد تبدیل می‌کند. */
  numericQuery: (min, max, fallback) =>
    z
      .union([z.string(), z.number()])
      .optional()
      .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
      .refine((v) => Number.isFinite(v) && v >= min && v <= max, {
        message: `مقدار باید عددی بین ${min} و ${max} باشد.`,
      }),

  isoDate: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'تاریخ معتبر نیست.' })
    .transform((v) => new Date(v)),
};

export { z };
