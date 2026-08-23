/**
 * موتور Geofence با هیسترزیس و debounce.
 *
 * ── مسئله‌ای که حل می‌کند ───────────────────────────────────────────────
 * اگر صرفاً «فاصله > شعاع» را چک کنیم، کاربری که دقیقاً روی مرز محدوده
 * ایستاده است با هر نوسان معمولی GPS (۱۰ تا ۳۰ متر در محیط شهری) یک بار
 * خارج و یک بار داخل تشخیص داده می‌شود. نتیجه: ده‌ها هشدار در چند دقیقه،
 * و خانواده‌ای که بعد از بار پنجم دیگر هیچ هشداری را جدی نمی‌گیرد.
 *
 * ── راه‌حل: دو سازوکار مستقل ─────────────────────────────────────────────
 *   ۱) هیسترزیس (باند مرده): آستانه‌ی خروج R+25 متر و آستانه‌ی بازگشت R−25 متر.
 *      بین این دو، هیچ تصمیمی گرفته نمی‌شود و وضعیت قبلی حفظ می‌گردد.
 *      برای اینکه نویز باعث تغییر وضعیت شود، باید ۵۰ متر جابه‌جایی واقعی رخ دهد.
 *   ۲) debounce: تغییر وضعیت تنها پس از N پینگ متوالیِ هم‌جهت تأیید می‌شود،
 *      تا یک پرش تکیِ GPS (که در تونل یا کنار ساختمان بلند رایج است) کافی نباشد.
 *
 * هسته‌ی تصمیم‌گیری یک تابع خالص است: نه به دیتابیس وابسته است نه به زمان،
 * پس می‌توان هزاران سناریو را در تست واحد بدون هیچ mock ای اجرا کرد.
 */
import { ZONE_STATE } from '../config/constants.js';
import { haversineDistance } from '../utils/geo.js';

/** پیکربندی پیش‌فرض؛ در عمل از متغیرهای محیطی می‌آید. */
export const DEFAULT_CONFIG = Object.freeze({
  hysteresisM: 25,
  debounceCount: 2,
  cooldownSec: 60,
});

/**
 * محاسبه‌ی دو آستانه‌ی هیسترزیس برای یک محدوده.
 *
 * برای محدوده‌های خیلی کوچک، هیسترزیسِ ثابت می‌تواند آستانه‌ی ورود را
 * منفی کند (مثلاً شعاع ۲۰ متر با هیسترزیس ۲۵ متر) که یعنی «هرگز داخل نیست».
 * پس هیسترزیس مؤثر حداکثر ۴۰٪ شعاع در نظر گرفته می‌شود.
 */
export function thresholdsFor(radiusM, config = DEFAULT_CONFIG) {
  const effective = Math.min(config.hysteresisM, radiusM * 0.4);
  return {
    exitThresholdM: radiusM + effective,
    enterThresholdM: radiusM - effective,
    effectiveHysteresisM: effective,
  };
}

/**
 * هسته‌ی تصمیم‌گیری — تابع خالص.
 *
 * @param {{state: string, consecutiveCount: number, pendingState: string|null}} previous وضعیت قبلی
 * @param {number} distanceM فاصله‌ی فعلی تا مرکز محدوده بر حسب متر
 * @param {number} radiusM شعاع محدوده
 * @param {object} [config]
 * @returns {{
 *   state: string,
 *   consecutiveCount: number,
 *   pendingState: string|null,
 *   transitioned: boolean,
 *   event: 'exit'|'enter'|null,
 *   observed: string|null,
 *   thresholds: object
 * }}
 */
export function evaluateTransition(previous, distanceM, radiusM, config = DEFAULT_CONFIG) {
  const thresholds = thresholdsFor(radiusM, config);
  const prevState = previous?.state ?? ZONE_STATE.UNKNOWN;
  const prevPending = previous?.pendingState ?? null;
  const prevCount = previous?.consecutiveCount ?? 0;

  // مشاهده‌ی خام: بیرونِ آستانه‌ی خروج، درونِ آستانه‌ی ورود، یا «نامعلوم» در باند مرده
  let observed = null;
  if (distanceM > thresholds.exitThresholdM) observed = ZONE_STATE.OUTSIDE;
  else if (distanceM < thresholds.enterThresholdM) observed = ZONE_STATE.INSIDE;

  const unchanged = {
    state: prevState,
    consecutiveCount: 0,
    pendingState: null,
    transitioned: false,
    event: null,
    observed,
    thresholds,
  };

  // داخل باند مرده: هیچ تصمیمی گرفته نمی‌شود و شمارنده‌ی در انتظار صفر می‌شود
  // تا عبور آهسته و رفت‌وبرگشتی از باند، به‌تدریج یک تغییر وضعیت جعلی نسازد.
  if (observed === null) return unchanged;

  // نخستین ارزیابی: وضعیت پذیرفته می‌شود اما هشداری صادر نمی‌شود.
  // در غیر این صورت هر کاربر تازه‌واردی که بیرون از خانه باشد،
  // بلافاصله یک هشدار «خروج از محدوده» تولید می‌کرد.
  if (prevState === ZONE_STATE.UNKNOWN) {
    return {
      state: observed,
      consecutiveCount: 0,
      pendingState: null,
      transitioned: true,
      event: null,
      observed,
      thresholds,
    };
  }

  // مشاهده با وضعیت فعلی هم‌خوان است: هر تغییرِ در انتظار لغو می‌شود
  if (observed === prevState) return unchanged;

  // مشاهده مخالف وضعیت فعلی است → شمارنده‌ی debounce
  const count = prevPending === observed ? prevCount + 1 : 1;

  if (count < config.debounceCount) {
    return {
      state: prevState,
      consecutiveCount: count,
      pendingState: observed,
      transitioned: false,
      event: null,
      observed,
      thresholds,
    };
  }

  // تغییر وضعیت تأیید شد
  return {
    state: observed,
    consecutiveCount: 0,
    pendingState: null,
    transitioned: true,
    event: observed === ZONE_STATE.OUTSIDE ? 'exit' : 'enter',
    observed,
    thresholds,
  };
}

/**
 * ارزیابی یک موقعیت در برابر یک محدوده — لایه‌ی نازک روی تابع خالص که
 * فاصله را هم خودش حساب می‌کند.
 */
export function evaluateZone({ lat, lng }, zone, previousState, config = DEFAULT_CONFIG) {
  const distanceM = haversineDistance(lat, lng, zone.centerLat, zone.centerLng);
  const result = evaluateTransition(previousState, distanceM, zone.radiusM, config);
  return { ...result, distanceM, zoneId: zone.id, zoneName: zone.name };
}

/**
 * ارزیابی یک موقعیت در برابر مجموعه‌ای از محدوده‌ها.
 *
 * @param {{lat:number,lng:number}} point
 * @param {Array} zones محدوده‌های فعال کاربر
 * @param {Map<string,object>} stateByZoneId وضعیت قبلی هر محدوده
 * @returns {Array} یک نتیجه به ازای هر محدوده
 */
export function evaluateAll(point, zones, stateByZoneId, config = DEFAULT_CONFIG) {
  return zones.map((zone) =>
    evaluateZone(point, zone, stateByZoneId.get(zone.id) ?? null, config),
  );
}

/**
 * آیا با توجه به دوره‌ی خاموشی، اجازه‌ی صدور هشدار هست؟
 * لایه‌ی سوم دفاع در برابر هشدار تکراری — حتی اگر منطق وضعیت اشتباه کند،
 * این سقفِ سخت جلوی سیل هشدار را می‌گیرد.
 */
export function isCooldownElapsed(lastAlertAt, config = DEFAULT_CONFIG, now = Date.now()) {
  if (!lastAlertAt) return true;
  const elapsedSec = (now - new Date(lastAlertAt).getTime()) / 1000;
  return elapsedSec >= config.cooldownSec;
}

/**
 * خلاصه‌ی وضعیت کلی کاربر برای نمایش در کارت داشبورد.
 *
 * قاعده: اگر کاربر داخل حداقل یکی از محدوده‌های امن باشد، وضعیت «داخل» است.
 * محدوده‌ها می‌توانند هم‌پوشانی داشته باشند (خانه و محله)، و منطقی است که
 * بودن در هر کدام کافی باشد.
 */
export function summarizeState(states) {
  if (!states || states.length === 0) {
    return { status: ZONE_STATE.UNKNOWN, insideZones: [], reason: 'no_zones' };
  }

  const inside = states.filter((s) => s.state === ZONE_STATE.INSIDE);
  if (inside.length > 0) {
    return { status: ZONE_STATE.INSIDE, insideZones: inside, reason: 'inside_zone' };
  }

  const known = states.filter((s) => s.state !== ZONE_STATE.UNKNOWN);
  if (known.length === 0) {
    return { status: ZONE_STATE.UNKNOWN, insideZones: [], reason: 'not_evaluated' };
  }

  return { status: ZONE_STATE.OUTSIDE, insideZones: [], reason: 'outside_all_zones' };
}
