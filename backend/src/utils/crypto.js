/**
 * توابع رمزنگاری: هش پسورد، تولید و هش کد دعوت، و مقایسه‌ی زمان‌ثابت.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import env from '../config/env.js';

/** هش پسورد با bcrypt. تعداد دورها از متغیرهای محیطی خوانده می‌شود. */
export async function hashPassword(plain) {
  return bcrypt.hash(plain, env.auth.bcryptRounds);
}

export async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

/**
 * تولید کد دعوت ۶ رقمی با منبع تصادفی امنِ رمزنگاری.
 * از Math.random استفاده نمی‌کنیم چون قابل پیش‌بینی است و کد دعوت
 * عملاً یک اعتبارنامه‌ی دسترسی به موقعیت زنده‌ی یک انسان است.
 */
export function generateInviteCode() {
  // randomInt توزیع یکنواخت دارد و سوگیری پیمانه‌ای ندارد
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * هش کد دعوت با HMAC-SHA256 و کلید سرور.
 *
 * چرا HMAC و نه bcrypt:
 *   ۱) فضای کد فقط ۱۰۶ حالت است؛ bcrypt هم جلوی brute-force آنلاین را نمی‌گیرد —
 *      آن را rate limiting و انقضای ۱۵ دقیقه‌ای می‌گیرد.
 *   ۲) با bcrypt نمی‌توان مستقیم کوئری زد و باید کل جدول پیمایش شود.
 *   ۳) HMAC با کلیدی که در دیتابیس نیست، یعنی نشتِ صرفِ دیتابیس
 *      اجازه‌ی جست‌وجوی آفلاینِ فضای کد را نمی‌دهد.
 */
export function hashInviteCode(code) {
  return crypto.createHmac('sha256', env.auth.invitePepper).update(String(code)).digest('hex');
}

/** هش توکن تازه‌سازی برای ذخیره در دیتابیس (خودِ توکن هرگز ذخیره نمی‌شود). */
export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** مقایسه‌ی زمان‌ثابت برای جلوگیری از حمله‌ی زمان‌سنجی. */
export function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export const randomId = () => crypto.randomUUID();
