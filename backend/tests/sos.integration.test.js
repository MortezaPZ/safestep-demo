/**
 * تست یکپارچه‌ی مسیر بحرانی: از ثبت‌نام تا هشدار اضطراری.
 *
 * این تست کل پشته را واقعاً اجرا می‌کند — Express، اعتبارسنجی، JWT،
 * PostgreSQL (نسخه‌ی درون‌حافظه‌ای)، موتور Geofence و توزیع هشدار.
 * هیچ چیزی mock نشده است؛ تنها تفاوت با اجرای واقعی، نبودِ پورت شبکه است.
 *
 * مهم‌ترین چیزی که اینجا اثبات می‌شود: کنترل دسترسی سطح‌رکورد واقعاً
 * enforce می‌شود، نه اینکه فقط در رابط کاربری پنهان شده باشد.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// دیتابیس درون‌حافظه‌ای، پیش از بارگذاری هر ماژولی که env را می‌خواند
process.env.PGLITE_DATA_DIR = 'memory';
process.env.DB_DRIVER = 'pglite';
process.env.NODE_ENV = 'test';
process.env.GEOFENCE_DEBOUNCE_COUNT = '2';
process.env.GEOFENCE_COOLDOWN_SEC = '0';

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');
const { runMigrations } = await import('../src/db/migrate.js');
const { destinationPoint } = await import('../src/utils/geo.js');

const HOME = { lat: 35.7219, lng: 51.3347 };
const PASSWORD = 'Test@1234';

let app;

/** ثبت‌نام و بازگرداندن توکن و شناسه. */
async function signUp(phone, fullName, role) {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ phone, password: PASSWORD, fullName, role });

  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id, user: res.body.user };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  await db.connect();
  await runMigrations();
  app = createApp();
});

afterAll(async () => {
  await db.close();
});

describe('مسیر کامل: ثبت‌نام تا هشدار اضطراری', () => {
  let maryam; // کاربر اصلی
  let ali; // عضو خانواده با دسترسی اضطراری
  let zahra; // عضو خانواده بدون دسترسی اضطراری
  let zoneId;

  it('کاربر اصلی و دو عضو خانواده ثبت‌نام می‌کنند', async () => {
    maryam = await signUp('09121110001', 'مریم رضایی', 'primary');
    ali = await signUp('09121110002', 'علی رضایی', 'guardian');
    zahra = await signUp('09121110003', 'زهرا رضایی', 'guardian');

    expect(maryam.user.role).toBe('primary');
    // شماره باید نرمال‌سازی شده باشد
    expect(maryam.user.phone).toBe('09121110001');
  });

  it('ورود با رمز اشتباه رد می‌شود', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: '09121110001', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('کاربر اصلی یک محدوده‌ی امن می‌سازد', async () => {
    const res = await request(app)
      .post('/api/v1/safe-zones')
      .set(auth(maryam.token))
      .send({ name: 'خانه', centerLat: HOME.lat, centerLng: HOME.lng, radiusM: 150 });

    expect(res.status).toBe(201);
    expect(res.body.thresholds.exitThresholdM).toBe(175);
    expect(res.body.thresholds.enterThresholdM).toBe(125);
    zoneId = res.body.id;
  });

  it('پیش از برقراری رابطه، عضو خانواده به موقعیت دسترسی ندارد', async () => {
    const res = await request(app)
      .get('/api/v1/locations/current')
      .query({ userId: maryam.id })
      .set(auth(ali.token));

    expect(res.status).toBe(403);
  });

  it('کد دعوت ساخته و توسط علی با دسترسی اضطراری مصرف می‌شود', async () => {
    const invite = await request(app)
      .post('/api/v1/guardianships/invites')
      .set(auth(maryam.token))
      .send({ permissions: ['view_location', 'receive_alerts', 'emergency'] });

    expect(invite.status).toBe(201);
    expect(invite.body.code).toMatch(/^\d{6}$/);

    const redeem = await request(app)
      .post('/api/v1/guardianships/redeem')
      .set(auth(ali.token))
      .send({ code: invite.body.code });

    expect(redeem.status).toBe(201);
    expect(redeem.body.guardianship.permissions).toContain('emergency');
  });

  it('همان کد دعوت بار دوم پذیرفته نمی‌شود', async () => {
    const invite = await request(app)
      .post('/api/v1/guardianships/invites')
      .set(auth(maryam.token))
      .send({ permissions: ['view_location'] });

    const first = await request(app)
      .post('/api/v1/guardianships/redeem')
      .set(auth(zahra.token))
      .send({ code: invite.body.code });
    expect(first.status).toBe(201);

    // تلاش دوباره با همان کد — این بار باید رد شود
    const second = await request(app)
      .post('/api/v1/guardianships/redeem')
      .set(auth(zahra.token))
      .send({ code: invite.body.code });

    expect(second.status).toBeGreaterThanOrEqual(400);
  });

  it('زهرا سطح دسترسی «دریافت هشدار» می‌گیرد اما نه اضطراری', async () => {
    const list = await request(app).get('/api/v1/guardianships').set(auth(maryam.token));
    const link = list.body.guardians.find((g) => g.guardianUserId === zahra.id);

    const res = await request(app)
      .patch(`/api/v1/guardianships/${link.id}`)
      .set(auth(maryam.token))
      .send({ permissions: ['view_location', 'receive_alerts'] });

    expect(res.status).toBe(200);
    expect(res.body.permissions).not.toContain('emergency');
  });

  it('پینگ داخل محدوده، هیچ هشداری تولید نمی‌کند', async () => {
    const res = await request(app)
      .post('/api/v1/locations/ping')
      .set(auth(maryam.token))
      .send({ lat: HOME.lat, lng: HOME.lng, batteryLevel: 90 });

    expect(res.status).toBe(201);
    expect(res.body.alerts).toHaveLength(0);
    expect(res.body.status.status).toBe('inside');
  });

  it('عضو خانواده حالا موقعیت زنده را می‌بیند', async () => {
    const res = await request(app)
      .get('/api/v1/locations/current')
      .query({ userId: maryam.id })
      .set(auth(ali.token));

    expect(res.status).toBe(200);
    expect(res.body.hidden).toBe(false);
    expect(res.body.location.lat).toBeCloseTo(HOME.lat, 4);
  });

  it('یک پینگ تکی بیرون از محدوده هنوز هشدار نمی‌دهد (debounce)', async () => {
    const far = destinationPoint(HOME.lat, HOME.lng, 400, 90);
    const res = await request(app)
      .post('/api/v1/locations/ping')
      .set(auth(maryam.token))
      .send({ lat: far.lat, lng: far.lng, batteryLevel: 89 });

    expect(res.body.alerts).toHaveLength(0);
  });

  it('پینگ دوم بیرون از محدوده، هشدار خروج تولید می‌کند', async () => {
    const far = destinationPoint(HOME.lat, HOME.lng, 420, 90);
    const res = await request(app)
      .post('/api/v1/locations/ping')
      .set(auth(maryam.token))
      .send({ lat: far.lat, lng: far.lng, batteryLevel: 88 });

    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.alerts[0].type).toBe('zone_exit');
    expect(res.body.alerts[0].severity).toBe('warning');
    expect(res.body.status.status).toBe('outside');
  });

  it('هر دو عضو خانواده هشدار خروج را در فهرست خود می‌بینند', async () => {
    for (const guardian of [ali, zahra]) {
      const res = await request(app)
        .get('/api/v1/alerts')
        .query({ types: 'zone_exit' })
        .set(auth(guardian.token));

      expect(res.status).toBe(200);
      expect(res.body.alerts.length).toBeGreaterThan(0);
      expect(res.body.alerts[0].subject.fullName).toBe('مریم رضایی');
    }
  });

  /* ─────────────────────────── مسیر SOS ─────────────────────────── */

  let sosAlertId;

  it('مخاطبان اضطراری پیش از فشردن دکمه قابل مشاهده‌اند', async () => {
    const res = await request(app).get('/api/v1/sos/contacts').set(auth(maryam.token));

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1); // فقط علی
    expect(res.body.contacts[0].fullName).toBe('علی رضایی');
  });

  it('فشردن SOS هشدار بحرانی می‌سازد و فقط به دارنده‌ی دسترسی اضطراری می‌رسد', async () => {
    const here = destinationPoint(HOME.lat, HOME.lng, 430, 90);

    const res = await request(app)
      .post('/api/v1/sos')
      .set(auth(maryam.token))
      .send({ lat: here.lat, lng: here.lng, batteryLevel: 87, note: 'حالم خوب نیست' });

    expect(res.status).toBe(201);
    expect(res.body.alert.type).toBe('sos');
    expect(res.body.alert.severity).toBe('critical');
    expect(res.body.location.source).toBe('live');

    // نکته‌ی کلیدی امنیتی: گیرنده فقط علی است، نه زهرا
    expect(res.body.recipients).toHaveLength(1);
    expect(res.body.recipients[0].fullName).toBe('علی رضایی');

    sosAlertId = res.body.alert.id;
  });

  it('علی هشدار SOS را می‌بیند', async () => {
    const res = await request(app)
      .get('/api/v1/alerts')
      .query({ types: 'sos' })
      .set(auth(ali.token));

    expect(res.body.alerts.some((a) => a.id === sosAlertId)).toBe(true);
  });

  it('هشدار SOS خوانده و سپس بسته می‌شود', async () => {
    const read = await request(app)
      .post(`/api/v1/alerts/${sosAlertId}/read`)
      .set(auth(ali.token));
    expect(read.status).toBe(200);

    const resolve = await request(app)
      .post(`/api/v1/alerts/${sosAlertId}/resolve`)
      .set(auth(ali.token));

    expect(resolve.status).toBe(200);
    expect(resolve.body.resolvedAt).not.toBeNull();
  });

  it('SOS با نرخ بالا محدود می‌شود', async () => {
    const results = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await request(app).post('/api/v1/sos').set(auth(maryam.token)).send({});
      results.push(res.status);
    }
    // سقف پیش‌فرض ۳ در دقیقه است، پس باید حداقل یک ۴۲۹ ببینیم
    expect(results).toContain(429);
  });

  /* ─────────────────── استقلال کاربر: قطع اشتراک ─────────────────── */

  it('با خاموش کردن اشتراک، موقعیت برای خانواده مخفی می‌شود', async () => {
    const off = await request(app)
      .put('/api/v1/locations/sharing')
      .set(auth(maryam.token))
      .send({ enabled: false });
    expect(off.status).toBe(200);

    const res = await request(app)
      .get('/api/v1/locations/current')
      .query({ userId: maryam.id })
      .set(auth(ali.token));

    expect(res.status).toBe(200);
    expect(res.body.hidden).toBe(true);
    expect(res.body.reason).toBe('sharing_disabled');
    expect(res.body.location).toBeNull();
  });

  it('کاربر اصلی همچنان موقعیت خودش را می‌بیند', async () => {
    const res = await request(app).get('/api/v1/locations/status').set(auth(maryam.token));

    expect(res.status).toBe(200);
    expect(res.body.location).not.toBeNull();
    expect(res.body.sharing.enabled).toBe(false);
    expect(res.body.sharing.viewerCount).toBe(0);
  });

  it('با روشن کردن دوباره، موقعیت برمی‌گردد', async () => {
    await request(app)
      .put('/api/v1/locations/sharing')
      .set(auth(maryam.token))
      .send({ enabled: true });

    const res = await request(app)
      .get('/api/v1/locations/current')
      .query({ userId: maryam.id })
      .set(auth(ali.token));

    expect(res.body.hidden).toBe(false);
  });

  /* ─────────────────── قطع دسترسی ─────────────────── */

  it('پس از قطع دسترسی، عضو خانواده دیگر چیزی نمی‌بیند', async () => {
    const list = await request(app).get('/api/v1/guardianships').set(auth(maryam.token));
    const link = list.body.guardians.find((g) => g.guardianUserId === zahra.id);

    const revoke = await request(app)
      .delete(`/api/v1/guardianships/${link.id}`)
      .set(auth(maryam.token));
    expect(revoke.status).toBe(200);

    const res = await request(app)
      .get('/api/v1/locations/current')
      .query({ userId: maryam.id })
      .set(auth(zahra.token));

    expect(res.status).toBe(403);
  });

  it('تاریخچه‌ی حذف‌شده واقعاً از دیتابیس پاک می‌شود', async () => {
    const before = await db.query('SELECT COUNT(*)::int AS c FROM location_pings WHERE user_id = $1', [
      maryam.id,
    ]);
    expect(before.rows[0].c).toBeGreaterThan(0);

    const res = await request(app).delete('/api/v1/locations/history').set(auth(maryam.token));
    expect(res.status).toBe(200);

    const after = await db.query('SELECT COUNT(*)::int AS c FROM location_pings WHERE user_id = $1', [
      maryam.id,
    ]);
    expect(after.rows[0].c).toBe(0);
  });
});

describe('اعتبارسنجی ورودی', () => {
  it('شماره موبایل نامعتبر رد می‌شود', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ phone: '123', password: PASSWORD, fullName: 'تست' });

    expect(res.status).toBe(400);
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('مختصات خارج از بازه رد می‌شود', async () => {
    const user = await signUp('09129998877', 'کاربر تست', 'primary');

    const res = await request(app)
      .post('/api/v1/locations/ping')
      .set(auth(user.token))
      .send({ lat: 200, lng: 51 });

    expect(res.status).toBe(400);
  });

  it('درخواست بدون توکن رد می‌شود', async () => {
    const res = await request(app).get('/api/v1/locations/status');
    expect(res.status).toBe(401);
  });

  it('شعاع کمتر از حد مجاز رد می‌شود', async () => {
    const user = await signUp('09129998866', 'کاربر تست دو', 'primary');

    const res = await request(app)
      .post('/api/v1/safe-zones')
      .set(auth(user.token))
      .send({ name: 'خیلی کوچک', centerLat: 35.7, centerLng: 51.4, radiusM: 10 });

    expect(res.status).toBe(400);
  });
});
