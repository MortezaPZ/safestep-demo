/**
 * سرویس احراز هویت — ثبت‌نام، ورود، تازه‌سازی و خروج.
 *
 * الگوی توکن: access کوتاه‌عمر (۱۵ دقیقه) + refresh بلندعمر (۳۰ روز) که
 * هشِ آن در دیتابیس ذخیره می‌شود. با هر تازه‌سازی، توکن قبلی باطل و توکن
 * تازه صادر می‌شود (rotation). فایده: اگر توکن تازه‌سازی دزدیده شود،
 * اولین استفاده‌ی هر یک از دو طرف، دیگری را از کار می‌اندازد و سرقت
 * حداکثر تا یک چرخه دوام می‌آورد.
 */
import env from '../config/env.js';
import { ROLES } from '../config/constants.js';
import * as userRepository from '../repositories/userRepository.js';
import { hashPassword, verifyPassword, hashToken } from '../utils/crypto.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken, ttlToMs } from '../utils/jwt.js';
import { conflict, unauthorized, notFound } from '../utils/errors.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'auth' });

/** پالت رنگ آواتار — به هر کاربر یکی اختصاص می‌یابد تا در نقشه قابل تفکیک باشد. */
const AVATAR_COLORS = ['#2F6FED', '#7C4DFF', '#00897B', '#F4511E', '#C2185B', '#5D4037'];

const pickAvatarColor = (phone) => {
  const sum = [...String(phone)].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
};

/**
 * نرمال‌سازی شماره‌ی موبایل به قالب ۱۱ رقمی ایرانی.
 * ورودی‌های ‎+98912...‎ و ‎0098912...‎ و ‎912...‎ همگی به ‎0912...‎ تبدیل می‌شوند
 * تا یک نفر نتواند با سه نگارش مختلف، سه حساب بسازد.
 */
export function normalizePhone(input) {
  // تبدیل ارقام فارسی و عربی به لاتین
  const digits = String(input)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\D/g, '');

  if (digits.startsWith('0098')) return `0${digits.slice(4)}`;
  if (digits.startsWith('98') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith('9') && digits.length === 10) return `0${digits}`;
  return digits;
}

/** صدور جفت توکن و ثبت نشست. */
async function issueTokens(user, userAgent) {
  const accessToken = signAccessToken(user);
  const { token: refreshToken, jti } = signRefreshToken(user);

  await userRepository.saveRefreshToken({
    userId: user.id,
    jti,
    tokenHash: hashToken(refreshToken),
    userAgent: userAgent ?? null,
    expiresAt: new Date(Date.now() + ttlToMs(env.auth.refreshTtl)),
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: Math.floor(ttlToMs(env.auth.accessTtl) / 1000),
  };
}

/* ─────────────────────────── ثبت‌نام ─────────────────────────── */

export async function register({ phone, password, fullName, role }, { userAgent } = {}) {
  const normalized = normalizePhone(phone);

  if (await userRepository.existsByPhone(normalized)) {
    throw conflict('این شماره قبلاً ثبت شده است. وارد شوید یا شماره‌ی دیگری بزنید.');
  }

  const user = await userRepository.create({
    phone: normalized,
    passwordHash: await hashPassword(password),
    fullName: fullName.trim(),
    role: role ?? ROLES.PRIMARY,
    avatarColor: pickAvatarColor(normalized),
  });

  const tokens = await issueTokens(user, userAgent);
  const settings = await userRepository.getSettings(user.id);

  log.info('کاربر جدید ثبت شد', { userId: user.id, role: user.role });

  return { user, settings, ...tokens };
}

/* ─────────────────────────── ورود ─────────────────────────── */

export async function login({ phone, password }, { userAgent } = {}) {
  const normalized = normalizePhone(phone);
  const record = await userRepository.findByPhoneWithSecret(normalized);

  // پیام خطا برای «کاربر نیست» و «رمز غلط» عمداً یکسان است تا نتوان
  // با آزمون‌وخطا فهمید کدام شماره در سامانه ثبت شده است.
  const invalid = () => unauthorized('شماره یا رمز عبور نادرست است.');

  if (!record) {
    // حتی وقتی کاربر وجود ندارد یک هش ساختگی بررسی می‌کنیم تا زمان پاسخ
    // در هر دو حالت یکسان بماند و از روی تأخیر نتوان وجود حساب را حدس زد.
    await verifyPassword(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid');
    throw invalid();
  }

  if (!(await verifyPassword(password, record.passwordHash))) throw invalid();

  const { passwordHash, ...user } = record;
  const tokens = await issueTokens(user, userAgent);
  const settings = await userRepository.getSettings(user.id);

  log.info('ورود موفق', { userId: user.id });

  return { user, settings, ...tokens };
}

/* ─────────────────────────── تازه‌سازی ─────────────────────────── */

export async function refresh(refreshToken, { userAgent } = {}) {
  const payload = verifyRefreshToken(refreshToken);
  const stored = await userRepository.findActiveRefreshToken(payload.jti);

  if (!stored) throw unauthorized('نشست شما معتبر نیست. دوباره وارد شوید.');

  // تطبیق هش توکن ارائه‌شده با آنچه ذخیره شده
  if (stored.token_hash !== hashToken(refreshToken)) {
    // این حالت یعنی توکنی با jti معتبر اما محتوای متفاوت ارائه شده —
    // نشانه‌ی دستکاری. کل نشست‌های کاربر باطل می‌شود.
    await userRepository.revokeAllRefreshTokens(payload.sub);
    log.warn('توکن تازه‌سازی مشکوک؛ تمام نشست‌ها باطل شد', { userId: payload.sub });
    throw unauthorized('نشست شما باطل شد. دوباره وارد شوید.');
  }

  const user = await userRepository.findById(payload.sub);
  if (!user) throw unauthorized('حساب کاربری یافت نشد.');

  // چرخش: توکن قبلی باطل و توکن تازه صادر می‌شود
  await userRepository.revokeRefreshToken(payload.jti);
  const tokens = await issueTokens(user, userAgent);

  return { user, ...tokens };
}

/* ─────────────────────────── خروج ─────────────────────────── */

export async function logout(refreshToken) {
  if (!refreshToken) return { ok: true };

  try {
    const payload = verifyRefreshToken(refreshToken);
    await userRepository.revokeRefreshToken(payload.jti);
    log.info('خروج از حساب', { userId: payload.sub });
  } catch {
    // توکن منقضی یا نامعتبر: خروج در هر صورت موفق تلقی می‌شود
  }

  return { ok: true };
}

export async function logoutAll(userId) {
  const count = await userRepository.revokeAllRefreshTokens(userId);
  return { ok: true, revokedSessions: count };
}

/* ─────────────────────────── پروفایل ─────────────────────────── */

export async function me(userId) {
  const [user, settings] = await Promise.all([
    userRepository.findById(userId),
    userRepository.getSettings(userId),
  ]);

  if (!user) throw notFound('حساب کاربری یافت نشد.');
  return { user, settings };
}

export default { register, login, refresh, logout, logoutAll, me, normalizePhone };
