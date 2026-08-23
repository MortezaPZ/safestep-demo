import { describe, it, expect } from 'vitest';
import {
  haversineDistance,
  bearing,
  destinationPoint,
  centroid,
  dispersionRadius,
  pathLength,
  interpolate,
  isValidCoordinate,
} from '../src/utils/geo.js';

// نقاط مرجع واقعی در تهران
const AZADI = { lat: 35.6997, lng: 51.338 };
const VANAK = { lat: 35.7575, lng: 51.41 };

describe('haversineDistance', () => {
  it('فاصله‌ی یک نقطه تا خودش صفر است', () => {
    expect(haversineDistance(35.7, 51.4, 35.7, 51.4)).toBe(0);
  });

  it('فاصله‌ی میدان آزادی تا ونک را با خطای کمتر از ۵٪ حساب می‌کند', () => {
    const d = haversineDistance(AZADI.lat, AZADI.lng, VANAK.lat, VANAK.lng);
    // فاصله‌ی هوایی واقعی حدود ۹.۱ کیلومتر است
    expect(d).toBeGreaterThan(8_700);
    expect(d).toBeLessThan(9_600);
  });

  it('متقارن است: فاصله‌ی الف تا ب برابر ب تا الف', () => {
    const ab = haversineDistance(AZADI.lat, AZADI.lng, VANAK.lat, VANAK.lng);
    const ba = haversineDistance(VANAK.lat, VANAK.lng, AZADI.lat, AZADI.lng);
    expect(ab).toBeCloseTo(ba, 6);
  });

  it('یک درجه عرض جغرافیایی حدود ۱۱۱ کیلومتر است', () => {
    const d = haversineDistance(35, 51, 36, 51);
    expect(d).toBeGreaterThan(110_500);
    expect(d).toBeLessThan(111_500);
  });

  it('در عرض تهران، یک درجه طول جغرافیایی کوتاه‌تر از یک درجه عرض است', () => {
    const lngDegree = haversineDistance(35.7, 51, 35.7, 52);
    const latDegree = haversineDistance(35.7, 51, 36.7, 51);
    // این تفاوت دقیقاً دلیل استفاده نکردن از فاصله‌ی اقلیدسی روی درجات است
    expect(lngDegree).toBeLessThan(latDegree * 0.85);
  });

  it('فاصله‌های بسیار کوچک را با دقت زیرمتری حساب می‌کند', () => {
    // حدود ۱۱ سانتی‌متر در راستای عرض جغرافیایی
    const d = haversineDistance(35.7, 51.4, 35.700001, 51.4);
    expect(d).toBeGreaterThan(0.05);
    expect(d).toBeLessThan(0.2);
  });

  it('مختصات نامعتبر را رد می‌کند', () => {
    expect(() => haversineDistance(95, 51, 35, 51)).toThrow(RangeError);
    expect(() => haversineDistance(35, 200, 35, 51)).toThrow(RangeError);
    expect(() => haversineDistance(NaN, 51, 35, 51)).toThrow(RangeError);
  });
});

describe('isValidCoordinate', () => {
  it('مرزهای معتبر را می‌پذیرد و خارج از آن را رد می‌کند', () => {
    expect(isValidCoordinate(90, 180)).toBe(true);
    expect(isValidCoordinate(-90, -180)).toBe(true);
    expect(isValidCoordinate(90.001, 0)).toBe(false);
    expect(isValidCoordinate(0, Infinity)).toBe(false);
  });
});

describe('destinationPoint و bearing', () => {
  it('حرکت به سمت شرق، طول جغرافیایی را زیاد و عرض را تقریباً ثابت نگه می‌دارد', () => {
    const dest = destinationPoint(35.7, 51.4, 1000, 90);
    expect(dest.lng).toBeGreaterThan(51.4);
    expect(dest.lat).toBeCloseTo(35.7, 4);
  });

  it('رفت و برگشت دقیقاً همان فاصله را می‌دهد', () => {
    const dest = destinationPoint(35.7, 51.4, 1500, 42);
    const back = haversineDistance(35.7, 51.4, dest.lat, dest.lng);
    expect(back).toBeCloseTo(1500, 1);
  });

  it('زاویه‌ی سمت به سمت شمال ۰ و به سمت شرق ۹۰ درجه است', () => {
    expect(bearing(35.7, 51.4, 35.8, 51.4)).toBeCloseTo(0, 1);
    expect(bearing(35.7, 51.4, 35.7, 51.5)).toBeCloseTo(90, 1);
  });
});

describe('centroid و dispersionRadius', () => {
  it('مرکز ثقل دو نقطه، وسط آن‌هاست', () => {
    const c = centroid([{ lat: 35, lng: 51 }, { lat: 36, lng: 52 }]);
    expect(c.lat).toBeCloseTo(35.5, 10);
    expect(c.lng).toBeCloseTo(51.5, 10);
  });

  it('پراکندگی نقاط یکسان صفر است', () => {
    const points = Array.from({ length: 5 }, () => ({ lat: 35.7, lng: 51.4 }));
    expect(dispersionRadius(points).radiusM).toBe(0);
  });

  it('پراکندگی خوشه‌ای کوچک، کمتر از شعاع پیش‌فرض توقف است', () => {
    const { radiusM } = dispersionRadius([
      { lat: 35.7, lng: 51.4 },
      { lat: 35.7002, lng: 51.4001 },
      { lat: 35.6999, lng: 51.3998 },
    ]);
    expect(radiusM).toBeLessThan(40);
  });

  it('روی مجموعه‌ی خالی خطا می‌دهد', () => {
    expect(() => centroid([])).toThrow();
  });
});

describe('pathLength', () => {
  it('برای کمتر از دو نقطه صفر است', () => {
    expect(pathLength([])).toBe(0);
    expect(pathLength([{ lat: 35, lng: 51 }])).toBe(0);
  });

  it('مجموع اضلاع را حساب می‌کند', () => {
    const p1 = { lat: 35.7, lng: 51.4 };
    const p2 = destinationPoint(p1.lat, p1.lng, 100, 0);
    const p3 = destinationPoint(p2.lat, p2.lng, 100, 90);
    expect(pathLength([p1, p2, p3])).toBeCloseTo(200, 0);
  });
});

describe('interpolate', () => {
  it('در t=0 و t=1 دقیقاً نقاط ابتدا و انتهاست', () => {
    const from = { lat: 35, lng: 51 };
    const to = { lat: 36, lng: 52 };
    expect(interpolate(from, to, 0)).toEqual(from);
    expect(interpolate(from, to, 1)).toEqual(to);
  });

  it('مقادیر خارج از بازه را محدود می‌کند', () => {
    const from = { lat: 35, lng: 51 };
    const to = { lat: 36, lng: 52 };
    expect(interpolate(from, to, 5)).toEqual(to);
    expect(interpolate(from, to, -3)).toEqual(from);
  });
});
