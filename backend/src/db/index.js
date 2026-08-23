/**
 * لایه‌ی دسترسی به دیتابیس با دو درایور قابل تعویض:
 *
 *   pg     → PostgreSQL واقعی از طریق شبکه (حالت docker compose)
 *   pglite → همان PostgreSQL، کامپایل‌شده به WebAssembly و اجراشده درون همین پردازه
 *
 * چرا این انتزاع وجود دارد:
 *   PGlite یک شبیه‌سازِ Postgres نیست؛ خودِ Postgres است. بنابراین دقیقاً همان
 *   SQL، همان migrationها و همان seed روی هر دو مسیر اجرا می‌شود و هیچ اختلاف
 *   رفتاری بین «حالت دمو» و «حالت تولید» وجود ندارد. این تنها دلیلِ پذیرفتنِ
 *   یک لایه‌ی انتزاعی اضافه است — در غیر این صورت مستقیم از pg استفاده می‌کردیم.
 *
 * تمام کوئری‌ها فقط از این ماژول عبور می‌کنند تا جایگزینی درایور، مخزن‌ها
 * (repositories) را دست‌نخورده بگذارد.
 */
import env from '../config/env.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'db' });

/** @type {{ query: Function, transaction: Function, exec: Function, close: Function } | null} */
let driver = null;
let driverName = null;

/* ─────────────────────────── درایور PostgreSQL شبکه‌ای ─────────────────────────── */

async function createPgDriver() {
  const { default: pg } = await import('pg');

  // Postgres ستون‌های عددی بزرگ (bigint/numeric) را به‌صورت رشته برمی‌گرداند تا
  // دقت از دست نرود. در این پروژه فقط id پینگ‌ها bigint است و در محدوده‌ی امنِ
  // Number جاوااسکریپت می‌ماند، پس آن را به عدد تبدیل می‌کنیم تا JSON خروجی تمیز بماند.
  pg.types.setTypeParser(20, (value) => (value === null ? null : Number(value)));
  // numeric/float8 هم به‌صورت عدد خوانده شود (مختصات جغرافیایی)
  pg.types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));

  const pool = new pg.Pool({
    connectionString: env.db.url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on('error', (err) => log.error('خطای غیرمنتظره در استخر اتصال', { error: err.message }));

  // اتصال اولیه را همین‌جا می‌آزماییم تا خطای پیکربندی زودهنگام و با پیام روشن دیده شود
  const probe = await pool.connect();
  probe.release();

  return {
    async query(text, params) {
      const res = await pool.query(text, params);
      return { rows: res.rows, rowCount: res.rowCount };
    },

    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          query: async (text, params) => {
            const res = await client.query(text, params);
            return { rows: res.rows, rowCount: res.rowCount };
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    /** اجرای اسکریپت چنددستوری (فقط برای migration و reset استفاده می‌شود). */
    async exec(sql) {
      await pool.query(sql);
    },

    async close() {
      await pool.end();
    },
  };
}

/* ─────────────────────── درایور PGlite (درون‌پردازه‌ای، WASM) ─────────────────────── */

async function createPgliteDriver() {
  const { PGlite } = await import('@electric-sql/pglite');

  const db = new PGlite(env.db.pgliteDataDir);
  await db.waitReady;

  /**
   * PGlite تک‌اتصاله است: کوئری‌های همزمان روی یک نمونه در هم می‌روند و
   * مهم‌تر از آن، BEGIN/COMMIT دو تراکنش موازی با هم قاطی می‌شود.
   * برای همین همه‌ی تراکنش‌ها را روی یک صف زنجیره‌ای سریال می‌کنیم.
   */
  let txChain = Promise.resolve();

  return {
    async query(text, params) {
      const res = await db.query(text, params);
      return { rows: res.rows ?? [], rowCount: res.affectedRows ?? res.rows?.length ?? 0 };
    },

    async transaction(fn) {
      const run = txChain.then(() =>
        db.transaction(async (tx) => {
          return fn({
            query: async (text, params) => {
              const res = await tx.query(text, params);
              return { rows: res.rows ?? [], rowCount: res.affectedRows ?? res.rows?.length ?? 0 };
            },
          });
        }),
      );
      // زنجیره نباید با شکستِ یک تراکنش قطع شود، وگرنه تراکنش‌های بعدی هم رد می‌شوند
      txChain = run.catch(() => {});
      return run;
    },

    async exec(sql) {
      await db.exec(sql);
    },

    async close() {
      await db.close();
    },
  };
}

/* ───────────────────────────────── واسط عمومی ───────────────────────────────── */

/** برقراری اتصال. اگر قبلاً متصل باشد، همان اتصال بازگردانده می‌شود. */
export async function connect() {
  if (driver) return driver;

  driverName = env.db.driver;
  const started = Date.now();

  if (driverName === 'pg') {
    driver = await createPgDriver();
  } else {
    driver = await createPgliteDriver();
  }

  log.info('اتصال به دیتابیس برقرار شد', {
    driver: driverName,
    ms: Date.now() - started,
    ...(driverName === 'pglite' ? { dataDir: env.db.pgliteDataDir } : {}),
  });

  return driver;
}

function requireDriver() {
  if (!driver) {
    throw new Error('اتصال دیتابیس هنوز برقرار نشده است. ابتدا connect() را صدا بزنید.');
  }
  return driver;
}

/**
 * اجرای یک کوئری.
 * @param {string} text دستور SQL با پارامترهای ‎$1, $2, ...
 * @param {any[]} [params]
 * @returns {Promise<{rows: any[], rowCount: number}>}
 */
export async function query(text, params) {
  const started = Date.now();
  try {
    return await requireDriver().query(text, params);
  } catch (error) {
    // خودِ SQL لاگ می‌شود اما پارامترها نه — ممکن است مختصات یا هش پسورد باشند
    log.error('کوئری با خطا مواجه شد', {
      sql: text.replace(/\s+/g, ' ').trim().slice(0, 200),
      error: error.message,
      ms: Date.now() - started,
    });
    throw error;
  }
}

/** اجرای یک تابع درون تراکنش. با هر خطایی، کل تراکنش برگردانده (rollback) می‌شود. */
export async function transaction(fn) {
  return requireDriver().transaction(fn);
}

/** اجرای اسکریپت چنددستوری — فقط برای migration و reset. */
export async function exec(sql) {
  return requireDriver().exec(sql);
}

export async function close() {
  if (!driver) return;
  await driver.close();
  driver = null;
  driverName = null;
  log.info('اتصال دیتابیس بسته شد');
}

/** نام درایور فعال — برای نمایش در ‎/health و پیام‌های راه‌اندازی. */
export const activeDriver = () => driverName;

/** بررسی سلامت اتصال برای endpoint سلامت. */
export async function healthCheck() {
  const started = Date.now();
  await query('SELECT 1');
  return { ok: true, driver: driverName, latencyMs: Date.now() - started };
}

export default { connect, query, transaction, exec, close, healthCheck, activeDriver };
