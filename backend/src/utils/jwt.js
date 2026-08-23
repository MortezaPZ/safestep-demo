/**
 * صدور و اعتبارسنجی توکن‌های JWT.
 * دو رازِ مجزا برای access و refresh استفاده می‌شود تا توکن یکی به‌جای دیگری پذیرفته نشود.
 */
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import env from '../config/env.js';
import { unauthorized } from './errors.js';

const ISSUER = 'safestep';

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, typ: 'access' },
    env.auth.accessSecret,
    { expiresIn: env.auth.accessTtl, issuer: ISSUER },
  );
}

/**
 * توکن تازه‌سازی شامل یک شناسه‌ی یکتا (jti) است تا بتوان
 * تک‌تک نشست‌ها را جداگانه در دیتابیس ابطال کرد.
 */
export function signRefreshToken(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { sub: user.id, typ: 'refresh', jti },
    env.auth.refreshSecret,
    { expiresIn: env.auth.refreshTtl, issuer: ISSUER },
  );
  return { token, jti };
}

export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, env.auth.accessSecret, { issuer: ISSUER });
    if (payload.typ !== 'access') throw new Error('نوع توکن نادرست است');
    return payload;
  } catch {
    throw unauthorized('نشست شما منقضی شده است. دوباره وارد شوید.');
  }
}

export function verifyRefreshToken(token) {
  try {
    const payload = jwt.verify(token, env.auth.refreshSecret, { issuer: ISSUER });
    if (payload.typ !== 'refresh') throw new Error('نوع توکن نادرست است');
    return payload;
  } catch {
    throw unauthorized('توکن تازه‌سازی نامعتبر یا منقضی است. دوباره وارد شوید.');
  }
}

/** تبدیل رشته‌هایی مثل «30d» یا «15m» به میلی‌ثانیه — برای محاسبه‌ی زمان انقضا. */
export function ttlToMs(ttl) {
  const match = /^(\d+)([smhd])$/.exec(String(ttl).trim());
  if (!match) throw new Error(`قالب TTL نامعتبر است: ${ttl}`);
  const value = Number(match[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
  return value * unit;
}
