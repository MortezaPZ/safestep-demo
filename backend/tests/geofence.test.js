import { describe, it, expect } from 'vitest';
import {
  evaluateTransition,
  evaluateZone,
  thresholdsFor,
  isCooldownElapsed,
  summarizeState,
  DEFAULT_CONFIG,
} from '../src/services/geofenceEngine.js';
import { ZONE_STATE } from '../src/config/constants.js';
import { destinationPoint } from '../src/utils/geo.js';

const RADIUS = 150;
const CONFIG = { ...DEFAULT_CONFIG, hysteresisM: 25, debounceCount: 2 };

const inside = () => ({ state: ZONE_STATE.INSIDE, consecutiveCount: 0, pendingState: null });
const outside = () => ({ state: ZONE_STATE.OUTSIDE, consecutiveCount: 0, pendingState: null });
const unknown = () => ({ state: ZONE_STATE.UNKNOWN, consecutiveCount: 0, pendingState: null });

/** اجرای دنباله‌ای از فاصله‌ها و شمردن رویدادهای صادرشده. */
function runSequence(distances, initial = inside(), config = CONFIG) {
  let state = initial;
  const events = [];
  for (const d of distances) {
    const result = evaluateTransition(state, d, RADIUS, config);
    if (result.event) events.push(result.event);
    state = {
      state: result.state,
      consecutiveCount: result.consecutiveCount,
      pendingState: result.pendingState,
    };
  }
  return { finalState: state, events };
}

describe('thresholdsFor', () => {
  it('آستانه‌ی خروج بالاتر و آستانه‌ی ورود پایین‌تر از شعاع است', () => {
    const t = thresholdsFor(150, CONFIG);
    expect(t.exitThresholdM).toBe(175);
    expect(t.enterThresholdM).toBe(125);
  });

  it('برای محدوده‌ی کوچک، هیسترزیس را محدود می‌کند تا آستانه‌ی ورود منفی نشود', () => {
    const t = thresholdsFor(50, CONFIG);
    expect(t.enterThresholdM).toBeGreaterThan(0);
    expect(t.effectiveHysteresisM).toBeLessThanOrEqual(20); // ۴۰٪ از ۵۰
  });
});

describe('اولین ارزیابی', () => {
  it('وضعیت را می‌پذیرد اما هشدار نمی‌دهد', () => {
    const r = evaluateTransition(unknown(), 400, RADIUS, CONFIG);
    expect(r.state).toBe(ZONE_STATE.OUTSIDE);
    expect(r.transitioned).toBe(true);
    expect(r.event).toBeNull(); // نکته‌ی کلیدی: کاربر تازه‌وارد هشدار نمی‌گیرد
  });
});

describe('باند مرده‌ی هیسترزیس', () => {
  it('فاصله‌ی بین دو آستانه هیچ تغییری ایجاد نمی‌کند', () => {
    for (const d of [130, 150, 170]) {
      const r = evaluateTransition(inside(), d, RADIUS, CONFIG);
      expect(r.state).toBe(ZONE_STATE.INSIDE);
      expect(r.event).toBeNull();
    }
  });

  it('وضعیت «خارج» هم داخل باند مرده حفظ می‌شود', () => {
    const r = evaluateTransition(outside(), 160, RADIUS, CONFIG);
    expect(r.state).toBe(ZONE_STATE.OUTSIDE);
    expect(r.event).toBeNull();
  });
});

describe('debounce', () => {
  it('یک پرش تکی GPS باعث هشدار نمی‌شود', () => {
    const { events, finalState } = runSequence([100, 100, 300, 100, 100]);
    expect(events).toEqual([]);
    expect(finalState.state).toBe(ZONE_STATE.INSIDE);
  });

  it('دو پینگ متوالی خارج، خروج را تأیید می‌کند', () => {
    const { events, finalState } = runSequence([100, 300, 300]);
    expect(events).toEqual(['exit']);
    expect(finalState.state).toBe(ZONE_STATE.OUTSIDE);
  });

  it('بازگشت به داخل هم همان دو پینگ تأیید را لازم دارد', () => {
    const { events } = runSequence([300, 300, 50, 50], inside());
    expect(events).toEqual(['exit', 'enter']);
  });
});

describe('سناریوی کلیدی: جلوگیری از هشدارهای لرزان روی مرز', () => {
  it('۲۰ نوسان GPS دقیقاً روی مرز، صفر هشدار تولید می‌کند', () => {
    // کاربر روی مرز ۱۵۰ متری ایستاده و GPS با نویز ±۲۰ متری می‌لرزد.
    // بدون هیسترزیس، هر بار عبور از ۱۵۰ یک هشدار می‌ساخت.
    const noisy = [];
    for (let i = 0; i < 20; i += 1) {
      noisy.push(i % 2 === 0 ? 145 : 165);
    }

    const { events } = runSequence(noisy);
    expect(events).toHaveLength(0);
  });

  it('بدون هیسترزیس همان دنباله ۱۹ بار تغییر وضعیت می‌داد', () => {
    // شاهدِ مقایسه: مقایسه‌ی ساده‌ی «فاصله > شعاع» روی همان داده
    const noisy = [];
    for (let i = 0; i < 20; i += 1) noisy.push(i % 2 === 0 ? 145 : 165);

    let naiveState = 'inside';
    let flaps = 0;
    for (const d of noisy) {
      const next = d > RADIUS ? 'outside' : 'inside';
      if (next !== naiveState) flaps += 1;
      naiveState = next;
    }

    expect(flaps).toBe(19); // ۱۹ هشدار در برابر صفر هشدارِ موتور واقعی
  });

  it('خروج واقعی همچنان دقیقاً یک هشدار می‌دهد', () => {
    // نویز روی مرز، سپس دور شدن واقعی
    const seq = [145, 165, 145, 165, 200, 250, 400, 600];
    const { events } = runSequence(seq);
    expect(events).toEqual(['exit']);
  });

  it('یک رفت و برگشت کامل، فقط دو رویداد تولید می‌کند', () => {
    const seq = [
      100, 110, 120, // داخل
      200, 300, 500, // خروج واقعی
      600, 700, 500, // بیرون
      100, 80, 60,   // بازگشت واقعی
    ];
    const { events } = runSequence(seq);
    expect(events).toEqual(['exit', 'enter']);
  });
});

describe('evaluateZone روی مختصات واقعی', () => {
  const zone = {
    id: 'zone-1',
    name: 'خانه',
    centerLat: 35.7219,
    centerLng: 51.3347,
    radiusM: RADIUS,
  };

  it('نقطه‌ی مرکز، داخل تشخیص داده می‌شود', () => {
    const r = evaluateZone({ lat: zone.centerLat, lng: zone.centerLng }, zone, unknown(), CONFIG);
    expect(r.state).toBe(ZONE_STATE.INSIDE);
    expect(r.distanceM).toBeCloseTo(0, 5);
  });

  it('نقطه‌ی ۵۰۰ متر دورتر، پس از تأیید خروج می‌دهد', () => {
    const far = destinationPoint(zone.centerLat, zone.centerLng, 500, 45);
    let state = inside();
    let lastEvent = null;

    for (let i = 0; i < 2; i += 1) {
      const r = evaluateZone(far, zone, state, CONFIG);
      lastEvent = r.event ?? lastEvent;
      state = { state: r.state, consecutiveCount: r.consecutiveCount, pendingState: r.pendingState };
    }

    expect(lastEvent).toBe('exit');
    expect(state.state).toBe(ZONE_STATE.OUTSIDE);
  });
});

describe('isCooldownElapsed', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);

  it('اگر هشدار قبلی نباشد، اجازه می‌دهد', () => {
    expect(isCooldownElapsed(null, CONFIG, now)).toBe(true);
  });

  it('هشدار ۱۰ ثانیه پیش را مسدود می‌کند', () => {
    expect(isCooldownElapsed(new Date(now - 10_000), CONFIG, now)).toBe(false);
  });

  it('هشدار ۹۰ ثانیه پیش را اجازه می‌دهد', () => {
    expect(isCooldownElapsed(new Date(now - 90_000), CONFIG, now)).toBe(true);
  });
});

describe('summarizeState', () => {
  it('بدون محدوده، وضعیت نامشخص است', () => {
    expect(summarizeState([]).status).toBe(ZONE_STATE.UNKNOWN);
  });

  it('بودن در یکی از چند محدوده کافی است', () => {
    const s = summarizeState([
      { zoneId: 'a', state: ZONE_STATE.OUTSIDE },
      { zoneId: 'b', state: ZONE_STATE.INSIDE },
    ]);
    expect(s.status).toBe(ZONE_STATE.INSIDE);
    expect(s.insideZones).toHaveLength(1);
  });

  it('خارج بودن از همه یعنی خارج', () => {
    const s = summarizeState([
      { zoneId: 'a', state: ZONE_STATE.OUTSIDE },
      { zoneId: 'b', state: ZONE_STATE.OUTSIDE },
    ]);
    expect(s.status).toBe(ZONE_STATE.OUTSIDE);
  });

  it('محدوده‌های ارزیابی‌نشده، وضعیت را نامشخص نگه می‌دارند', () => {
    const s = summarizeState([{ zoneId: 'a', state: ZONE_STATE.UNKNOWN }]);
    expect(s.status).toBe(ZONE_STATE.UNKNOWN);
  });
});
