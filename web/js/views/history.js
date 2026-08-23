/**
 * صفحه‌ی تاریخچه‌ی مسیر.
 *
 * مسیر با گرادیان زمانی رسم می‌شود: قدیمی کم‌رنگ و نازک، تازه پررنگ و
 * ضخیم. بدون این گرادیان، یک خط یکنواخت نمی‌گوید کاربر از کجا به کجا رفته
 * و بیننده باید حدس بزند.
 *
 * دکمه‌ی حذف تاریخچه واقعاً داده را از دیتابیس پاک می‌کند. این را در
 * دیالوگ تأیید صریح می‌گوییم، چون تعهد محصول است نه ادعای بازاریابی.
 */
import api from '../api.js';
import SafeMap from '../map.js';
import { el, render, toast, confirmDialog, skeleton, emptyState, errorState } from '../ui.js';
import {
  faDate, faTime, faDayLabel, faDistance, faDuration, faNumber, faSpeed, faPercent,
} from '../format.js';

export function mountHistory(container, ctx, params = {}) {
  const subjectId = params.userId ?? ctx.user.id;
  const isOwn = subjectId === ctx.user.id;

  let days = [];
  let selectedDay = null;
  let points = [];
  let stats = null;
  let hidden = false;
  let map = null;
  let destroyed = false;

  /* ─────────────────────── انتخاب روز ─────────────────────── */

  function renderDayPicker() {
    if (days.length === 0) return null;

    return el('div.chip-row.mb-4', { role: 'group', ariaLabel: 'انتخاب روز' },
      ...days.slice(0, 14).map((day) =>
        el('button', {
          class: 'chip chip--button',
          type: 'button',
          ariaPressed: String(selectedDay === day.day),
          text: `${faDayLabel(day.day)} (${faNumber(day.pingCount)} نقطه)`,
          onClick: () => {
            selectedDay = day.day;
            loadDay();
          },
        }),
      ),
    );
  }

  /* ─────────────────────── آمار روز ─────────────────────── */

  function renderStats() {
    if (!stats || stats.pingCount === 0) return null;

    // طول مسیر از روی نقاط محاسبه می‌شود، چون سرور آن را ذخیره نمی‌کند
    let totalMeters = 0;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const dLat = (b.lat - a.lat) * 111_320;
      const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
      totalMeters += Math.hypot(dLat, dLng);
    }

    const durationMinutes =
      stats.firstAt && stats.lastAt
        ? (new Date(stats.lastAt) - new Date(stats.firstAt)) / 60_000
        : 0;

    return el('div.stat-grid.mb-4', {},
      el('div.stat', {},
        el('div.stat__value.tabular', { text: faDistance(totalMeters) }),
        el('div.stat__label', { text: 'مسافت طی‌شده' }),
      ),
      el('div.stat', {},
        el('div.stat__value.tabular', { text: faDuration(durationMinutes) }),
        el('div.stat__label', { text: 'بازه‌ی فعالیت' }),
      ),
      el('div.stat', {},
        el('div.stat__value.tabular', { text: faNumber(stats.pingCount) }),
        el('div.stat__label', { text: 'نقطه‌ی ثبت‌شده' }),
      ),
      el('div.stat', {},
        el('div.stat__value.tabular', {
          text: stats.firstAt ? faTime(stats.firstAt) : '—',
        }),
        el('div.stat__label', { text: 'اولین ثبت' }),
      ),
      el('div.stat', {},
        el('div.stat__value.tabular', {
          text: stats.lastAt ? faTime(stats.lastAt) : '—',
        }),
        el('div.stat__label', { text: 'آخرین ثبت' }),
      ),
      stats.minBattery !== null
        ? el('div.stat', {},
            el('div.stat__value.tabular', { text: faPercent(stats.minBattery) }),
            el('div.stat__label', { text: 'کمترین باتری' }),
          )
        : null,
    );
  }

  /* ─────────────────────── نقشه ─────────────────────── */

  function renderMapCard() {
    const mapEl = el('div.map', { role: 'application', ariaLabel: 'نقشه‌ی مسیر طی‌شده' });

    queueMicrotask(() => {
      if (destroyed || !document.body.contains(mapEl)) return;

      map?.destroy();
      map = new SafeMap(mapEl, { zoom: 14 });
      map.setTrack(points);

      if (params.focus?.lat && params.focus?.lng) {
        map.setUserMarker('focus', params.focus, { status: 'sos', label: params.focus.title });
      }

      map.fitAll({ force: true });
      map.invalidate();
    });

    const hasSimulated = points.some((p) => p.isSimulated);

    return el('div.map-wrap', {},
      mapEl,
      el('div.map-overlay.map-overlay--top', {},
        el('span.map-badge', { text: `📍 ${faNumber(points.length)} نقطه` }),
        hasSimulated ? el('span.map-badge', { text: '🎬 شامل داده‌ی حالت نمایش' }) : null,
      ),
      el('div.map-overlay.map-overlay--bottom', {},
        el('span.map-badge', { text: 'کم‌رنگ = قدیمی‌تر · پررنگ = تازه‌تر' }),
      ),
    );
  }

  /* ─────────────────────── حذف تاریخچه ─────────────────────── */

  async function deleteHistory() {
    const confirmed = await confirmDialog({
      title: 'حذف تاریخچه‌ی مسیر؟',
      message:
        'تمام نقاط ثبت‌شده‌ی این روز برای همیشه از دیتابیس پاک می‌شوند — نه اینکه فقط مخفی شوند. این کار قابل بازگشت نیست.',
      confirmLabel: 'بله، پاک کن',
    });

    if (!confirmed) return;

    try {
      const from = new Date(selectedDay);
      const to = new Date(from);
      to.setHours(23, 59, 59, 999);

      const result = await api.deleteHistory(from, to);
      toast('حذف شد', `${faNumber(result.deleted)} نقطه پاک شد.`);
      await load();
    } catch (error) {
      toast('حذف ناموفق بود', error.message, { severity: 'warning' });
    }
  }

  /* ─────────────────────── چیدمان ─────────────────────── */

  function renderAll() {
    if (destroyed) return;

    if (hidden) {
      render(container,
        el('div.card', {}, el('div.card__body', {},
          el('div.hidden-location', {},
            el('div', { text: '🙈', style: { fontSize: '2rem' } }),
            el('h3.state-block__title', { text: 'تاریخچه در دسترس نیست' }),
            el('p.state-block__text', {
              text: 'کاربر اشتراک‌گذاری موقعیت را خاموش کرده است.',
            }),
          ),
        )),
      );
      return;
    }

    if (days.length === 0) {
      render(container,
        el('div.card', {}, el('div.card__body', {},
          emptyState({
            icon: '🗺️',
            title: 'تاریخچه‌ای ثبت نشده',
            text: isOwn
              ? 'وقتی موقعیت شما ثبت شود، مسیر روزانه اینجا نمایش داده می‌شود.'
              : 'برای این کاربر هنوز مسیری ثبت نشده است.',
          }),
        )),
      );
      return;
    }

    render(
      container,
      el('div.card', {},
        el('div.card__header', {},
          el('h2.card__title', { text: 'تاریخچه‌ی مسیر' }),
          el('div.header-spacer'),
          isOwn && points.length > 0
            ? el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: '🗑️ حذف تاریخچه‌ی این روز',
                onClick: deleteHistory,
              })
            : null,
        ),
        el('div.card__body', {},
          renderDayPicker(),
          renderStats(),
          points.length > 0
            ? renderMapCard()
            : emptyState({
                icon: '📭',
                title: 'برای این روز نقطه‌ای ثبت نشده',
                text: 'روز دیگری را انتخاب کنید.',
              }),
        ),
      ),
    );
  }

  /* ─────────────────────── داده ─────────────────────── */

  async function loadDay() {
    if (!selectedDay) return;

    const from = new Date(selectedDay);
    const to = new Date(from);
    to.setHours(23, 59, 59, 999);

    try {
      const result = await api.history(subjectId, from, to, 3000);

      hidden = Boolean(result.hidden);
      points = result.points ?? [];
      stats = result.stats ?? null;

      renderAll();
    } catch (error) {
      render(container, errorState({ text: error.message, onRetry: loadDay }));
    }
  }

  async function load() {
    if (container.childElementCount === 0) {
      render(container, el('div.skeleton.skeleton--title'), el('div.skeleton.skeleton--map'));
    }

    try {
      const result = await api.historyDays(subjectId);
      days = result.days ?? [];

      if (days.length > 0) {
        selectedDay = days[0].day;
        await loadDay();
      } else {
        renderAll();
      }
    } catch (error) {
      render(container, errorState({ text: error.message, onRetry: load }));
    }
  }

  load();

  return () => {
    destroyed = true;
    map?.destroy();
  };
}

export default mountHistory;
