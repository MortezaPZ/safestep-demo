/**
 * لاگر ساده با خروجی JSON در تولید و خروجی خوانا در توسعه.
 *
 * قاعده‌ی امنیتی پروژه: مختصات جغرافیایی هرگز خام لاگ نمی‌شود.
 * لاگ‌ها معمولاً به سرویس‌های ثالث می‌روند و عمر طولانی دارند؛ نشت تاریخچه‌ی
 * حرکتی یک فرد دارای محدودیت، دقیقاً همان تهدیدی است که این محصول باید از آن محافظت کند.
 */
import env from '../config/env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const activeLevel = LEVELS[env.isTest ? 'warn' : env.isProduction ? 'info' : 'debug'];

/** کلیدهایی که مقدارشان هرگز نباید در لاگ ظاهر شود. */
const SENSITIVE_KEYS = new Set([
  'lat', 'lng', 'latitude', 'longitude', 'centerLat', 'centerLng',
  'center_lat', 'center_lng', 'password', 'passwordHash', 'password_hash',
  'token', 'accessToken', 'refreshToken', 'code', 'codeHash', 'code_hash',
  'pushToken', 'push_token', 'authorization',
]);

/** جایگزینی بازگشتی مقادیر حساس با برچسب. عمق زیاد کوتاه می‌شود تا لاگ منفجر نشود. */
function redact(value, depth = 0) {
  if (depth > 4) return '[عمق زیاد]';
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key)) {
      out[key] = typeof val === 'number' ? '[موقعیت حذف‌شده]' : '[حذف‌شده]';
    } else {
      out[key] = redact(val, depth + 1);
    }
  }
  return out;
}

const COLORS = { debug: '\u001b[90m', info: '\u001b[36m', warn: '\u001b[33m', error: '\u001b[31m' };
const RESET = '\u001b[0m';

function write(level, message, meta) {
  if (LEVELS[level] < activeLevel) return;

  const safeMeta = meta === undefined ? undefined : redact(meta);
  const time = new Date().toISOString();

  if (env.isProduction) {
    process.stdout.write(`${JSON.stringify({ time, level, message, ...safeMeta })}\n`);
    return;
  }

  const metaText = safeMeta ? ` ${JSON.stringify(safeMeta)}` : '';
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(
    `${COLORS[level]}${time.slice(11, 19)} ${level.toUpperCase().padEnd(5)}${RESET} ${message}${metaText}\n`,
  );
}

const logger = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
  /** ساخت لاگری که همیشه یک بافت ثابت (مثلاً نام سرویس) را همراه می‌برد. */
  child: (context) => ({
    debug: (m, meta) => write('debug', m, { ...context, ...meta }),
    info: (m, meta) => write('info', m, { ...context, ...meta }),
    warn: (m, meta) => write('warn', m, { ...context, ...meta }),
    error: (m, meta) => write('error', m, { ...context, ...meta }),
  }),
};

export { redact };
export default logger;
