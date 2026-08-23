import { describe, it, expect } from 'vitest';
import {
  detectStop,
  shouldAlertStop,
  detectGpsLost,
  DEFAULT_STOP_CONFIG,
} from '../src/services/stopDetector.js';
import { destinationPoint } from '../src/utils/geo.js';

const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);
const HOME = { lat: 35.7219, lng: 51.3347 };
const CONFIG = { ...DEFAULT_STOP_CONFIG, windowMinutes: 20, radiusM: 40, minPings: 4 };

/**
 * ساخت دنباله‌ی پینگ که پنجره را پر می‌کند.
 * @param {number} count تعداد پینگ
 * @param {(i:number)=>{lat:number,lng:number}} positionAt موقعیت هر پینگ
 * @param {number} spanMinutes بازه‌ی زمانی کل که پینگ‌ها در آن پخش می‌شوند
 */
function buildPings(count, positionAt, spanMinutes = 20) {
  const stepMs = (spanMinutes * 60_000) / (count - 1);
  return Array.from({ length: count }, (_, i) => ({
    ...positionAt(i),
    recordedAt: new Date(NOW - spanMinutes * 60_000 + i * stepMs).toISOString(),
  }));
}

describe('detectStop — حالت‌های ناکافی بودن داده', () => {
  it('بدون داده، توقف تشخیص داده نمی‌شود', () => {
    const r = detectStop([], CONFIG, NOW);
    expect(r.isStopped).toBe(false);
    expect(r.reason).toBe('no_data');
  });

  it('با پینگ کمتر از حد نصاب، رد می‌شود', () => {
    const pings = buildPings(3, () => HOME);
    const r = detectStop(pings, CONFIG, NOW);
    expect(r.isStopped).toBe(false);
    expect(r.reason).toBe('insufficient_pings');
  });

  it('اگر پنجره کامل پوشیده نشده باشد، ادعای توقف نمی‌کند', () => {
    // ۸ پینگ، اما همه در ۵ دقیقه‌ی اخیر
    const pings = buildPings(8, () => HOME, 5);
    const r = detectStop(pings, CONFIG, NOW);
    expect(r.isStopped).toBe(false);
    expect(r.reason).toBe('window_not_covered');
  });

  it('پینگ‌های خارج از پنجره نادیده گرفته می‌شوند', () => {
    const old = Array.from({ length: 10 }, (_, i) => ({
      ...HOME,
      recordedAt: new Date(NOW - 120 * 60_000 + i * 60_000).toISOString(),
    }));
    const r = detectStop(old, CONFIG, NOW);
    expect(r.isStopped).toBe(false);
    expect(r.pingCount).toBe(0);
  });
});

describe('detectStop — تشخیص توقف واقعی', () => {
  it('کاربر ثابت در یک نقطه، توقف طولانی تشخیص داده می‌شود', () => {
    const pings = buildPings(10, () => HOME);
    const r = detectStop(pings, CONFIG, NOW);

    expect(r.isStopped).toBe(true);
    expect(r.reason).toBe('stopped');
    expect(r.dispersionM).toBeLessThan(1);
    expect(r.durationMinutes).toBeCloseTo(20, 0);
  });

  it('نوسان کوچک GPS در جای ثابت، همچنان توقف است', () => {
    // پراکندگی حدود ۱۵ متر — کمتر از شعاع ۴۰ متری
    const pings = buildPings(12, (i) =>
      destinationPoint(HOME.lat, HOME.lng, 15, (i * 360) / 12),
    );
    const r = detectStop(pings, CONFIG, NOW);

    expect(r.isStopped).toBe(true);
    expect(r.dispersionM).toBeLessThan(CONFIG.radiusM);
  });

  it('پیاده‌روی مستمر، توقف تشخیص داده نمی‌شود', () => {
    // هر پینگ ۵۰ متر جلوتر → پراکندگی بسیار بیشتر از ۴۰ متر
    const pings = buildPings(12, (i) => destinationPoint(HOME.lat, HOME.lng, i * 50, 90));
    const r = detectStop(pings, CONFIG, NOW);

    expect(r.isStopped).toBe(false);
    expect(r.reason).toBe('moving');
  });

  it('دور زدن و بازگشت به نقطه‌ی اول، توقف محسوب نمی‌شود', () => {
    // این دقیقاً حالتی است که سنجه‌ی «فاصله‌ی اول تا آخر» اشتباه تشخیص می‌داد:
    // نقطه‌ی شروع و پایان یکی است، ولی کاربر ۲۰۰ متر دور شده و برگشته.
    const pings = buildPings(13, (i) => {
      const angle = (i * 360) / 12;
      return destinationPoint(HOME.lat, HOME.lng, 200, angle);
    });
    const r = detectStop(pings, CONFIG, NOW);

    expect(r.isStopped).toBe(false);
    expect(r.reason).toBe('moving');
    expect(r.dispersionM).toBeGreaterThan(CONFIG.radiusM);
  });
});

describe('detectStop — شکاف داده', () => {
  it('اگر بین پینگ‌ها شکاف بزرگ باشد، ادعای توقف نمی‌کند', () => {
    // ۵ پینگ در ابتدای پنجره و ۵ پینگ در انتها، با ۱۲ دقیقه سکوت در میان.
    // پراکندگی صفر است اما ما نمی‌دانیم در آن ۱۲ دقیقه چه گذشته.
    const early = Array.from({ length: 5 }, (_, i) => ({
      ...HOME,
      recordedAt: new Date(NOW - 20 * 60_000 + i * 60_000).toISOString(),
    }));
    const late = Array.from({ length: 5 }, (_, i) => ({
      ...HOME,
      recordedAt: new Date(NOW - 4 * 60_000 + i * 60_000).toISOString(),
    }));

    const r = detectStop([...early, ...late], CONFIG, NOW);
    expect(r.isStopped).toBe(false);
    expect(r.reason).toBe('data_gap');
    expect(r.maxGapMinutes).toBeGreaterThan(CONFIG.maxGapMinutes);
  });
});

describe('detectStop — پیکربندی‌پذیری', () => {
  it('شعاع سخت‌گیرانه‌تر، همان داده را «در حال حرکت» می‌بیند', () => {
    const pings = buildPings(12, (i) =>
      destinationPoint(HOME.lat, HOME.lng, 30, (i * 360) / 12),
    );

    expect(detectStop(pings, { ...CONFIG, radiusM: 40 }, NOW).isStopped).toBe(true);
    expect(detectStop(pings, { ...CONFIG, radiusM: 10 }, NOW).isStopped).toBe(false);
  });

  it('پنجره‌ی کوتاه‌تر، توقف را زودتر تشخیص می‌دهد', () => {
    const pings = buildPings(8, () => HOME, 10);

    expect(detectStop(pings, { ...CONFIG, windowMinutes: 20 }, NOW).isStopped).toBe(false);
    expect(detectStop(pings, { ...CONFIG, windowMinutes: 10 }, NOW).isStopped).toBe(true);
  });
});

describe('shouldAlertStop', () => {
  it('بدون هشدار قبلی اجازه می‌دهد', () => {
    expect(shouldAlertStop(null, CONFIG, NOW)).toBe(true);
  });

  it('هشدار ۵ دقیقه پیش را مسدود می‌کند', () => {
    expect(shouldAlertStop(new Date(NOW - 5 * 60_000), CONFIG, NOW)).toBe(false);
  });

  it('پس از گذشت یک پنجره‌ی کامل، هشدار دوم مجاز است', () => {
    expect(shouldAlertStop(new Date(NOW - 21 * 60_000), CONFIG, NOW)).toBe(true);
  });
});

describe('detectGpsLost', () => {
  it('پینگ تازه یعنی ارتباط برقرار است', () => {
    const r = detectGpsLost(new Date(NOW - 30_000), 180, NOW);
    expect(r.isLost).toBe(false);
  });

  it('سکوت طولانی‌تر از آستانه یعنی قطع ارتباط', () => {
    const r = detectGpsLost(new Date(NOW - 300_000), 180, NOW);
    expect(r.isLost).toBe(true);
    expect(r.silentSeconds).toBe(300);
  });

  it('نبودِ هیچ پینگی، قطع ارتباط گزارش نمی‌شود', () => {
    expect(detectGpsLost(null, 180, NOW).isLost).toBe(false);
  });
});
