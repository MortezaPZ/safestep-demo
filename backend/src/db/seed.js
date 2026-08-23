/**
 * داده‌ی نمونه‌ی واقع‌گرایانه برای دمو.
 *
 * ── چه چیزی ساخته می‌شود ─────────────────────────────────────────────────
 *   • یک خانواده‌ی سه‌نفره: کاربر اصلی + دو عضو خانواده با سطح دسترسی متفاوت
 *   • سه محدوده‌ی امن واقعی روی نقشه‌ی تهران
 *   • دو روز تاریخچه‌ی مسیر با الگوی رفتاری باورپذیر (نه نویز تصادفی)
 *   • هشدارهای متنوع از انواع مختلف، پخش‌شده در دو روز گذشته
 *
 * ── چرا تاریخچه ساختگی است اما تصادفی نیست ───────────────────────────────
 * مسیرها با همان توابع هندسی واقعی سیستم ساخته می‌شوند و از نظر سرعت و
 * فاصله در محدوده‌ی پیاده‌روی انسان‌اند. تمام این پینگ‌ها با پرچم
 * ‎is_simulated = TRUE ثبت می‌شوند تا در رابط کاربری از داده‌ی واقعی
 * قابل تفکیک باشند.
 *
 * اجرا:  npm run seed
 */
import db from './index.js';
import { runMigrations } from './migrate.js';
import env from '../config/env.js';
import { hashPassword } from '../utils/crypto.js';
import { destinationPoint, interpolate } from '../utils/geo.js';
import { ALERT_TYPES, ALERT_SEVERITY, PERMISSIONS } from '../config/constants.js';
import { composeAlertMessage } from '../services/alertService.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'seed' });

/* ═══════════════════════════ تعریف داده ═══════════════════════════ */

/** خانه‌ی کاربر اصلی — محله‌ی ستارخان تهران. */
const HOME = { lat: 35.7219, lng: 51.3347 };

const USERS = {
  primary: {
    phone: '09121110001',
    fullName: 'مریم رضایی',
    role: 'primary',
    avatarColor: '#2F6FED',
  },
  son: {
    phone: '09121110002',
    fullName: 'علی رضایی',
    role: 'guardian',
    avatarColor: '#00897B',
  },
  daughter: {
    phone: '09121110003',
    fullName: 'زهرا رضایی',
    role: 'guardian',
    avatarColor: '#7C4DFF',
  },
};

const SAFE_ZONES = [
  {
    name: 'خانه',
    center: HOME,
    radiusM: 150,
    color: '#2F6FED',
    icon: 'home',
  },
  {
    name: 'مرکز توان‌بخشی',
    center: destinationPoint(HOME.lat, HOME.lng, 1400, 75),
    radiusM: 200,
    color: '#00897B',
    icon: 'hospital',
  },
  {
    name: 'پارک محله',
    center: destinationPoint(HOME.lat, HOME.lng, 600, 190),
    radiusM: 180,
    color: '#7C4DFF',
    icon: 'park',
  },
];

/* ═══════════════════════════ ابزار کمکی ═══════════════════════════ */

const dayStart = (daysAgo) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d;
};

/** ساخت زمان مشخص در یک روز گذشته. */
const at = (daysAgo, hour, minute = 0) => {
  const d = dayStart(daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d;
};

/** نویز کوچک و واقع‌گرایانه‌ی GPS. */
const jitter = (point, meters = 7) =>
  destinationPoint(point.lat, point.lng, Math.random() * meters, Math.random() * 360);

/**
 * ساخت یک قطعه مسیر بین دو نقطه با فاصله‌ی زمانی مشخص.
 * @returns {Array<{lat,lng,recordedAt,speedMps,batteryLevel}>}
 */
function walkSegment(from, to, startTime, { stepSeconds = 30, battery = 90 }) {
  const points = [];
  // سرعت پیاده‌روی ۱.۳ متر بر ثانیه → فاصله‌ی هر گام
  const totalMeters = Math.max(
    1,
    Math.hypot((to.lat - from.lat) * 111_000, (to.lng - from.lng) * 90_000),
  );
  const steps = Math.max(2, Math.ceil(totalMeters / (1.3 * stepSeconds)));

  for (let i = 0; i <= steps; i += 1) {
    const raw = interpolate(from, to, i / steps);
    const noisy = jitter(raw);
    points.push({
      lat: noisy.lat,
      lng: noisy.lng,
      recordedAt: new Date(startTime.getTime() + i * stepSeconds * 1000),
      speedMps: 1.1 + Math.random() * 0.5,
      batteryLevel: Math.max(5, Math.round(battery - i * 0.05)),
    });
  }

  return points;
}

/** توقف در یک نقطه به مدت مشخص. */
function stayAt(point, startTime, minutes, { stepSeconds = 60, battery = 85 }) {
  const points = [];
  const count = Math.ceil((minutes * 60) / stepSeconds);

  for (let i = 0; i < count; i += 1) {
    const noisy = jitter(point, 9);
    points.push({
      lat: noisy.lat,
      lng: noisy.lng,
      recordedAt: new Date(startTime.getTime() + i * stepSeconds * 1000),
      speedMps: 0,
      batteryLevel: Math.max(5, Math.round(battery - i * 0.03)),
    });
  }

  return points;
}

/* ═══════════════════════════ اجرای seed ═══════════════════════════ */

/** پاک کردن داده‌ی قبلی. جدول users آبشاری بقیه را هم پاک می‌کند. */
async function clearExisting() {
  const phones = Object.values(USERS).map((u) => u.phone);
  const { rowCount } = await db.query('DELETE FROM users WHERE phone = ANY($1::text[])', [phones]);
  if (rowCount > 0) log.info('داده‌ی نمونه‌ی قبلی پاک شد', { deletedUsers: rowCount });
}

async function createUsers() {
  const passwordHash = await hashPassword(env.seedPassword);
  const created = {};

  for (const [key, user] of Object.entries(USERS)) {
    const { rows } = await db.query(
      `INSERT INTO users (phone, password_hash, full_name, role, avatar_color)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, full_name, phone, role`,
      [user.phone, passwordHash, user.fullName, user.role, user.avatarColor],
    );
    created[key] = rows[0];

    await db.query('INSERT INTO user_settings (user_id) VALUES ($1)', [rows[0].id]);
  }

  // کاربر اصلی آستانه‌ی توقف کوتاه‌تری دارد تا در دمو زودتر فعال شود
  await db.query(
    `UPDATE user_settings SET long_stop_minutes = 15, long_stop_radius_m = 40
     WHERE user_id = $1`,
    [created.primary.id],
  );

  return created;
}

async function createGuardianships(users) {
  // پسر: دسترسی کامل شامل اضطراری
  await db.query(
    `INSERT INTO guardianships (primary_user_id, guardian_user_id, permissions, nickname)
     VALUES ($1, $2, $3, $4)`,
    [
      users.primary.id,
      users.son.id,
      [PERMISSIONS.VIEW_LOCATION, PERMISSIONS.RECEIVE_ALERTS, PERMISSIONS.EMERGENCY],
      'پسرم',
    ],
  );

  // دختر: فقط مشاهده و هشدار — نمونه‌ی عملی تفاوت سطوح دسترسی
  await db.query(
    `INSERT INTO guardianships (primary_user_id, guardian_user_id, permissions, nickname)
     VALUES ($1, $2, $3, $4)`,
    [
      users.primary.id,
      users.daughter.id,
      [PERMISSIONS.VIEW_LOCATION, PERMISSIONS.RECEIVE_ALERTS],
      'دخترم',
    ],
  );
}

async function createSafeZones(users) {
  const zones = {};

  for (const zone of SAFE_ZONES) {
    const { rows } = await db.query(
      `INSERT INTO safe_zones (user_id, name, center_lat, center_lng, radius_m, color, icon)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name`,
      [
        users.primary.id,
        zone.name,
        zone.center.lat,
        zone.center.lng,
        zone.radiusM,
        zone.color,
        zone.icon,
      ],
    );
    zones[zone.name] = rows[0];
  }

  // وضعیت فعلی: داخل خانه
  await db.query(
    `INSERT INTO zone_states (user_id, zone_id, state, last_distance_m, last_transition_at)
     VALUES ($1, $2, 'inside', 35, now())`,
    [users.primary.id, zones['خانه'].id],
  );

  for (const name of ['مرکز توان‌بخشی', 'پارک محله']) {
    await db.query(
      `INSERT INTO zone_states (user_id, zone_id, state, last_distance_m, last_transition_at)
       VALUES ($1, $2, 'outside', 1200, now())`,
      [users.primary.id, zones[name].id],
    );
  }

  return zones;
}

/**
 * دو روز تاریخچه‌ی مسیر با الگوی رفتاری روزانه.
 * روز گذشته: رفتن به مرکز توان‌بخشی و بازگشت.
 * امروز: قدم زدن در پارک محله و بازگشت به خانه.
 */
async function createLocationHistory(users) {
  const rehab = SAFE_ZONES[1].center;
  const park = SAFE_ZONES[2].center;

  const points = [];

  // ── دیروز: خانه → مرکز توان‌بخشی → خانه ──
  points.push(...stayAt(HOME, at(1, 8, 0), 45, { battery: 96 }));
  points.push(...walkSegment(HOME, rehab, at(1, 9, 0), { battery: 92 }));
  points.push(...stayAt(rehab, at(1, 9, 45), 75, { battery: 88 }));
  points.push(...walkSegment(rehab, HOME, at(1, 11, 10), { battery: 80 }));
  points.push(...stayAt(HOME, at(1, 12, 0), 120, { battery: 74 }));

  // ── امروز: خانه → پارک → خانه ──
  points.push(...stayAt(HOME, at(0, 8, 30), 30, { battery: 98 }));
  points.push(...walkSegment(HOME, park, at(0, 9, 15), { battery: 95 }));
  points.push(...stayAt(park, at(0, 9, 35), 40, { battery: 92 }));
  points.push(...walkSegment(park, HOME, at(0, 10, 20), { battery: 88 }));
  points.push(...stayAt(HOME, at(0, 10, 40), 60, { battery: 85 }));

  // فقط نقاطی که در گذشته‌اند (اگر seed صبح اجرا شود، بعدازظهر ساخته نشود)
  const now = Date.now();
  const valid = points.filter((p) => p.recordedAt.getTime() <= now);

  // درج دسته‌ای برای سرعت — یک INSERT با چند ردیف
  const CHUNK = 250;
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK);
    const values = [];
    const params = [];

    chunk.forEach((p, index) => {
      const base = index * 7;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, TRUE)`,
      );
      params.push(users.primary.id, p.lat, p.lng, 8.5, p.speedMps, p.batteryLevel, p.recordedAt);
    });

    // درج مستقیم در جدول (نه از طریق جدول مشتق) تا Postgres نوع هر ستون را
    // از خودِ تعریف جدول استنتاج کند؛ در غیر این صورت پارامترها text فرض
    // می‌شوند و uuid و timestamptz رد می‌شوند.
    await db.query(
      `INSERT INTO location_pings
         (user_id, lat, lng, accuracy_m, speed_mps, battery_level, recorded_at, is_simulated)
       VALUES ${values.join(', ')}`,
      params,
    );
  }

  return valid.length;
}

/**
 * هشدارهای متنوع در دو روز گذشته.
 * ترکیب عمدی است: چند نوع مختلف، چند سطح اهمیت، بعضی خوانده و بعضی نخوانده،
 * تا صفحه‌ی هشدارها با فیلترها و حالت‌های مختلفش واقعاً قابل نمایش باشد.
 */
async function createAlerts(users, zones) {
  const rehab = SAFE_ZONES[1].center;
  const park = SAFE_ZONES[2].center;

  const definitions = [
    {
      type: ALERT_TYPES.ZONE_EXIT,
      when: at(1, 9, 6),
      zone: 'خانه',
      location: destinationPoint(HOME.lat, HOME.lng, 190, 75),
      metadata: { distanceM: 190, radiusM: 150, exitThresholdM: 175 },
      readBy: ['son', 'daughter'],
    },
    {
      type: ALERT_TYPES.ZONE_ENTER,
      when: at(1, 9, 52),
      zone: 'مرکز توان‌بخشی',
      location: rehab,
      metadata: { distanceM: 40, radiusM: 200 },
      readBy: ['son'],
    },
    {
      type: ALERT_TYPES.LONG_STOP,
      when: at(1, 10, 40),
      location: rehab,
      context: { durationMinutes: 55 },
      metadata: { durationMinutes: 55, dispersionM: 12.4, pingCount: 55 },
      readBy: ['son', 'daughter'],
    },
    {
      type: ALERT_TYPES.ZONE_ENTER,
      when: at(1, 11, 48),
      zone: 'خانه',
      location: HOME,
      metadata: { distanceM: 30, radiusM: 150 },
      readBy: ['son', 'daughter'],
    },
    {
      type: ALERT_TYPES.LOW_BATTERY,
      when: at(1, 17, 20),
      location: HOME,
      context: { batteryLevel: 14 },
      metadata: { batteryLevel: 14 },
      readBy: ['daughter'],
    },
    {
      type: ALERT_TYPES.GPS_LOST,
      when: at(1, 19, 5),
      location: HOME,
      context: { silentSeconds: 420 },
      metadata: { silentSeconds: 420 },
      readBy: [],
    },
    {
      type: ALERT_TYPES.ZONE_EXIT,
      when: at(0, 9, 21),
      zone: 'خانه',
      location: destinationPoint(HOME.lat, HOME.lng, 200, 190),
      metadata: { distanceM: 200, radiusM: 150, exitThresholdM: 175 },
      readBy: ['son'],
    },
    {
      type: ALERT_TYPES.SOS,
      when: at(0, 9, 48),
      location: park,
      metadata: {
        locationSource: 'live',
        isStaleLocation: false,
        batteryLevel: 92,
        note: 'حالم خوب نیست، لطفاً بیایید دنبالم',
      },
      resolvedAt: at(0, 10, 2),
      resolvedBy: 'son',
      readBy: ['son', 'daughter'],
    },
  ];

  const now = Date.now();
  let created = 0;

  for (const def of definitions) {
    if (def.when.getTime() > now) continue; // هشدار آینده ساخته نمی‌شود

    const zoneId = def.zone ? zones[def.zone].id : null;
    const { title, body } = composeAlertMessage(def.type, {
      ...def.context,
      userName: users.primary.full_name,
      zoneName: def.zone,
    });

    const { rows } = await db.query(
      `INSERT INTO alerts
         (user_id, type, severity, title, body, lat, lng, zone_id, metadata, created_at, resolved_at, resolved_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
       RETURNING id`,
      [
        users.primary.id,
        def.type,
        ALERT_SEVERITY[def.type],
        title,
        body,
        def.location?.lat ?? null,
        def.location?.lng ?? null,
        zoneId,
        JSON.stringify(def.metadata ?? {}),
        def.when,
        def.resolvedAt ?? null,
        def.resolvedBy ? users[def.resolvedBy].id : null,
      ],
    );

    for (const readerKey of def.readBy) {
      await db.query(
        `INSERT INTO alert_reads (alert_id, user_id, read_at)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [rows[0].id, users[readerKey].id, new Date(def.when.getTime() + 5 * 60_000)],
      );
    }

    created += 1;
  }

  return created;
}

async function createDevices(users) {
  await db.query(
    `INSERT INTO devices (user_id, platform, device_name, battery_level)
     VALUES ($1, 'android', 'موبایل مریم', 85),
            ($2, 'android', 'موبایل علی', 62),
            ($3, 'web', 'مرورگر زهرا', NULL)`,
    [users.primary.id, users.son.id, users.daughter.id],
  );
}

/* ═══════════════════════════ اجرا ═══════════════════════════ */

export async function seed() {
  await db.connect();
  await runMigrations();

  await clearExisting();

  const users = await createUsers();
  await createGuardianships(users);
  const zones = await createSafeZones(users);
  const pingCount = await createLocationHistory(users);
  const alertCount = await createAlerts(users, zones);
  await createDevices(users);

  return { users, zones, pingCount, alertCount };
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('db/seed.js');

if (isDirectRun) {
  try {
    const result = await seed();

    const lines = [
      '',
      '  ✅ داده‌ی نمونه با موفقیت ساخته شد',
      '',
      '  ┌─ حساب‌های آماده ────────────────────────────────────────────┐',
      `  │  کاربر اصلی    ${USERS.primary.phone}   ${USERS.primary.fullName}`,
      `  │  عضو خانواده   ${USERS.son.phone}   ${USERS.son.fullName} (دسترسی کامل + اضطراری)`,
      `  │  عضو خانواده   ${USERS.daughter.phone}   ${USERS.daughter.fullName} (بدون دسترسی اضطراری)`,
      '  │',
      `  │  رمز عبور همه: ${env.seedPassword}`,
      '  └────────────────────────────────────────────────────────────┘',
      '',
      `  محدوده‌ی امن      : ${Object.keys(result.zones).length} مورد`,
      `  پینگ موقعیت      : ${result.pingCount} نقطه (۲ روز تاریخچه)`,
      `  هشدار            : ${result.alertCount} مورد`,
      '',
    ];

    process.stdout.write(`${lines.join('\n')}\n`);
    await db.close();
    process.exit(0);
  } catch (error) {
    log.error('ساخت داده‌ی نمونه شکست خورد', { error: error.message, stack: error.stack });
    process.stderr.write(`\n❌ خطا: ${error.message}\n\n`);
    await db.close().catch(() => {});
    process.exit(1);
  }
}
