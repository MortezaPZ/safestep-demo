/**
 * نقطه‌ی ورود سرور.
 *
 * ترتیب راه‌اندازی عمدی است:
 *   ۱) بررسی رازها در حالت تولید — پیش از هر کاری، تا سرور با رازِ پیش‌فرض بالا نیاید
 *   ۲) اتصال دیتابیس و اجرای مهاجرت‌ها — تا اولین درخواست با جدول ناموجود مواجه نشود
 *   ۳) بالا آوردن HTTP و WebSocket
 */
import http from 'node:http';
import env, { assertProductionSecrets } from './config/env.js';
import { createApp } from './app.js';
import db from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { attachSocket } from './realtime/socket.js';
import simulatorService from './services/simulatorService.js';
import notificationAdapter from './services/notificationAdapter.js';
import logger from './utils/logger.js';

const log = logger.child({ module: 'server' });

/** بنر راه‌اندازی — وضعیت واقعی سیستم را صادقانه نشان می‌دهد. */
function printBanner() {
  const driver = db.activeDriver();
  const notify = notificationAdapter.status();

  const lines = [
    '',
    '  ┌────────────────────────────────────────────────────────────┐',
    '  │  SafeStep / هم‌قدم — سرویس ایمنی و ردیابی                  │',
    '  └────────────────────────────────────────────────────────────┘',
    '',
    `  آدرس سرویس   : http://localhost:${env.port}`,
    `  داشبورد وب   : http://localhost:${env.port}/`,
    `  سلامت سرویس  : http://localhost:${env.port}/health`,
    '',
    `  دیتابیس      : ${driver === 'pglite' ? 'PostgreSQL درون‌پردازه‌ای (PGlite/WASM)' : 'PostgreSQL شبکه‌ای'}`,
    `  نوتیفیکیشن   : ${notify.driver === 'fcm' ? 'FCM واقعی' : 'مسیر درون‌برنامه‌ای + WebSocket'}`,
    `  حالت نمایش   : ${env.demo.enabled ? 'فعال (شبیه‌ساز موقعیت در دسترس)' : 'غیرفعال'}`,
    '',
  ];

  process.stdout.write(`${lines.join('\n')}\n`);
}

async function start() {
  assertProductionSecrets();

  await db.connect();
  await runMigrations();

  const app = createApp();
  const server = http.createServer(app);
  attachSocket(server);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(env.port, resolve);
  });

  log.info('سرور آماده است', { port: env.port, env: env.nodeEnv });
  printBanner();

  /* ─────────────────────── خاموش شدن تمیز ─────────────────────── */

  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info('در حال خاموش شدن', { signal });

    // شبیه‌سازها اول متوقف می‌شوند تا وسط نوشتن در دیتابیس قطع نشوند
    simulatorService.stopAll();

    server.close(async () => {
      await db.close().catch(() => {});
      log.info('خاموش شد');
      process.exit(0);
    });

    // اگر اتصالی معلق ماند، بعد از ۱۰ ثانیه به‌هرحال خارج می‌شویم
    setTimeout(() => {
      log.warn('خاموش شدن اجباری پس از مهلت');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    log.error('Promise رد شده و مدیریت‌نشده', { reason: String(reason) });
  });

  process.on('uncaughtException', (error) => {
    log.error('خطای مدیریت‌نشده؛ خاموش می‌شویم', { message: error.message, stack: error.stack });
    shutdown('uncaughtException');
  });

  return server;
}

start().catch(async (error) => {
  log.error('راه‌اندازی سرور شکست خورد', { message: error.message, stack: error.stack });
  process.stderr.write(`\n❌ سرور بالا نیامد: ${error.message}\n\n`);
  await db.close().catch(() => {});
  process.exit(1);
});
