/**
 * بارگذاری و اعتبارسنجی متغیرهای محیطی.
 * تمام کلیدها فقط از اینجا خوانده می‌شوند تا هیچ process.env پراکنده‌ای در کد نماند.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const str = (key, fallback) => {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
};
const num = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`متغیر محیطی ${key} باید عدد باشد (مقدار فعلی: ${v})`);
  return n;
};
const bool = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

/**
 * انتخاب درایور دیتابیس.
 * اولویت: DB_DRIVER صریح → اگر DATABASE_URL بود pg → در غیر این صورت pglite.
 * هدف: دمو روی ماشینی که Docker ندارد هم بدون هیچ تنظیمی بالا بیاید.
 */
function resolveDbDriver() {
  const explicit = str('DB_DRIVER', '').toLowerCase();
  if (explicit === 'pg' || explicit === 'postgres' || explicit === 'postgresql') return 'pg';
  if (explicit === 'pglite') return 'pglite';
  if (explicit) throw new Error(`DB_DRIVER نامعتبر است: ${explicit} (مقادیر مجاز: pg | pglite)`);
  return str('DATABASE_URL', '') ? 'pg' : 'pglite';
}

const nodeEnv = str('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';

const env = {
  BACKEND_ROOT,
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  port: num('PORT', 4000),
  // پوشه‌ی وب‌اپ. پیش‌فرض کنار backend است؛ در کانتینر با WEB_ROOT بازنویسی می‌شود.
  webRoot: path.resolve(BACKEND_ROOT, str('WEB_ROOT', '../web')),
  corsOrigins: str('CORS_ORIGINS', 'http://localhost:4000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  db: {
    driver: resolveDbDriver(),
    url: str('DATABASE_URL', ''),
    // مقدار «memory» یعنی دیتابیس فقط در حافظه باشد و روی دیسک چیزی ننویسد.
    // تست‌های یکپارچه از همین استفاده می‌کنند تا هر اجرا از دیتابیس تمیز شروع شود.
    pgliteDataDir: ['memory', 'memory://'].includes(str('PGLITE_DATA_DIR', ''))
      ? undefined
      : path.resolve(BACKEND_ROOT, str('PGLITE_DATA_DIR', './.pglite')),
  },

  auth: {
    accessSecret: str('JWT_ACCESS_SECRET', 'dev-only-access-secret-change-me-in-production'),
    refreshSecret: str('JWT_REFRESH_SECRET', 'dev-only-refresh-secret-change-me-in-production'),
    accessTtl: str('JWT_ACCESS_TTL', '15m'),
    refreshTtl: str('JWT_REFRESH_TTL', '30d'),
    invitePepper: str('INVITE_CODE_PEPPER', 'dev-only-invite-pepper-change-me-in-production'),
    bcryptRounds: num('BCRYPT_ROUNDS', 10),
  },

  rateLimit: {
    authMax: num('RATE_LIMIT_AUTH_MAX', 10),
    authWindowMs: num('RATE_LIMIT_AUTH_WINDOW_MS', 15 * 60 * 1000),
    sosMax: num('RATE_LIMIT_SOS_MAX', 3),
    sosWindowMs: num('RATE_LIMIT_SOS_WINDOW_MS', 60 * 1000),
    inviteMax: num('RATE_LIMIT_INVITE_MAX', 20),
    inviteWindowMs: num('RATE_LIMIT_INVITE_WINDOW_MS', 15 * 60 * 1000),
  },

  geofence: {
    hysteresisM: num('GEOFENCE_HYSTERESIS_M', 25),
    debounceCount: num('GEOFENCE_DEBOUNCE_COUNT', 2),
    cooldownSec: num('GEOFENCE_COOLDOWN_SEC', 60),
  },

  stopDetect: {
    defaultMinutes: num('STOP_DETECT_DEFAULT_MINUTES', 20),
    defaultRadiusM: num('STOP_DETECT_DEFAULT_RADIUS_M', 40),
    minPings: num('STOP_DETECT_MIN_PINGS', 4),
  },

  gpsLostAfterSec: num('GPS_LOST_AFTER_SEC', 180),

  notification: {
    driver: str('NOTIFICATION_DRIVER', 'auto'),
    fcmServerKey: str('FCM_SERVER_KEY', ''),
    fcmProjectId: str('FCM_PROJECT_ID', ''),
  },

  demo: {
    enabled: bool('DEMO_MODE', true),
    tickMs: num('SIMULATOR_TICK_MS', 1500),
  },

  seedPassword: str('SEED_DEFAULT_PASSWORD', 'Test@1234'),
};

/** در محیط تولید اجازه نمی‌دهیم رازهای پیش‌فرض توسعه باقی بماند. */
export function assertProductionSecrets() {
  if (!env.isProduction) return;
  const weak = [
    ['JWT_ACCESS_SECRET', env.auth.accessSecret],
    ['JWT_REFRESH_SECRET', env.auth.refreshSecret],
    ['INVITE_CODE_PEPPER', env.auth.invitePepper],
  ].filter(([, value]) => value.startsWith('dev-only-'));

  if (weak.length > 0) {
    throw new Error(
      `در حالت production نمی‌توان از رازهای پیش‌فرض استفاده کرد: ${weak.map(([k]) => k).join(', ')}`,
    );
  }
}

export default env;
