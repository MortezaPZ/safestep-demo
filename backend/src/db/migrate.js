/**
 * اجراکننده‌ی مهاجرت‌ها (migrations).
 *
 * فایل‌های ‎migrations/*.sql به ترتیب نام اجرا می‌شوند و نام هر فایلِ اجراشده
 * در جدول ‎schema_migrations ثبت می‌گردد تا دوباره اجرا نشود.
 * هر مهاجرت درون یک تراکنش اجرا می‌شود: یا کامل اعمال می‌شود یا هیچ.
 *
 * اجرا:  npm run migrate
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './index.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'migrate' });
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** فقط نام‌هایی با این الگو پذیرفته می‌شوند — هم نظم می‌آورد و هم جلوی تزریق در INSERT را می‌گیرد. */
const VALID_NAME = /^\d{3}_[a-z0-9_]+\.sql$/;

async function ensureMigrationsTable() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function appliedVersions() {
  const { rows } = await db.query('SELECT version FROM schema_migrations');
  return new Set(rows.map((r) => r.version));
}

async function migrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  const files = entries.filter((f) => f.endsWith('.sql')).sort();

  const invalid = files.filter((f) => !VALID_NAME.test(f));
  if (invalid.length > 0) {
    throw new Error(
      `نام فایل مهاجرت نامعتبر است: ${invalid.join(', ')} — الگوی درست: 001_snake_case.sql`,
    );
  }
  return files;
}

/**
 * اجرای تمام مهاجرت‌های اعمال‌نشده.
 * @returns {Promise<string[]>} فهرست مهاجرت‌هایی که در این اجرا اعمال شدند
 */
export async function runMigrations() {
  await db.connect();
  await ensureMigrationsTable();

  const applied = await appliedVersions();
  const files = await migrationFiles();
  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    log.info('دیتابیس به‌روز است؛ مهاجرت جدیدی وجود ندارد', { total: files.length });
    return [];
  }

  log.info('اجرای مهاجرت‌های جدید', { pending: pending.length });

  for (const file of pending) {
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const started = Date.now();

    // نام فایل با VALID_NAME اعتبارسنجی شده، پس درج مستقیم آن امن است
    await db.exec(`BEGIN;\n${sql}\n;INSERT INTO schema_migrations (version) VALUES ('${file}');\nCOMMIT;`);

    log.info('مهاجرت اعمال شد', { file, ms: Date.now() - started });
  }

  return pending;
}

// اگر مستقیم اجرا شود (نه import)، مهاجرت‌ها را اجرا کن و خارج شو
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  try {
    const applied = await runMigrations();
    console.log(
      applied.length > 0
        ? `\n✅ ${applied.length} مهاجرت با موفقیت اعمال شد.\n`
        : '\n✅ دیتابیس از قبل به‌روز بود.\n',
    );
    await db.close();
    process.exit(0);
  } catch (error) {
    log.error('اجرای مهاجرت‌ها شکست خورد', { error: error.message });
    console.error(`\n❌ خطا: ${error.message}\n`);
    await db.close().catch(() => {});
    process.exit(1);
  }
}
