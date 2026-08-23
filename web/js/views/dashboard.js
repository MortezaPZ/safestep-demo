/**
 * داشبورد کاربر اصلی.
 *
 * ترتیب عناصر عمدی است و از بالا به پایین اهمیت کم می‌شود:
 *   ۱) بنر اشتراک‌گذاری — «چه کسی مرا می‌بیند» و دکمه‌ی قطع فوری
 *   ۲) کارت وضعیت — بزرگ، سه‌حالته، با متن صریح در کنار رنگ
 *   ۳) دکمه‌ی SOS — دایره‌ای بزرگ، در دسترس با یک دست
 *   ۴) نقشه و جزئیات
 *
 * بنر اشتراک‌گذاری عمداً بالای همه‌چیز است. اگر کاربر باید بین «ایمنی» و
 * «حس تحت نظر بودن» تعادل حس کند، اولین چیزی که می‌بیند باید کنترلِ
 * خودش باشد، نه گزارشی که دیگران از او می‌گیرند.
 */
import api from '../api.js';
import realtime, { WS_EVENTS } from '../realtime.js';
import SafeMap from '../map.js';
import { el, render, toast, dialog, confirmDialog, haptic, skeleton, errorState } from '../ui.js';
import {
  faRelativeTime, faDistance, faPercent, faNumber, faTime,
  STATUS_LABELS, initials, batteryLabel,
} from '../format.js';

export function mountDashboard(container, ctx) {
  let status = null;
  let map = null;
  let destroyed = false;
  const unsubscribers = [];

  /* ─────────────────────── بنر اشتراک‌گذاری ─────────────────────── */

  function renderSharingBanner() {
    const sharing = status?.sharing ?? { enabled: true, viewerCount: 0, viewers: [] };
    const isOn = sharing.enabled;
    const count = sharing.viewerCount;

    return el(
      'div.sharing-banner',
      { dataOff: String(!isOn) },
      el('div.sharing-banner__icon', { text: isOn ? '👁️' : '🙈', ariaHidden: 'true' }),
      el(
        'div.sharing-banner__text',
        {},
        el('div.sharing-banner__title', {
          text: isOn
            ? count > 0
              ? `شما در حال اشتراک موقعیت با ${faNumber(count)} نفر هستید`
              : 'اشتراک موقعیت روشن است — هنوز کسی اضافه نشده'
            : 'اشتراک موقعیت خاموش است',
        }),
        el('div.sharing-banner__sub', {
          text: isOn
            ? 'هر وقت بخواهید می‌توانید قطعش کنید. کنترل با شماست.'
            : 'هیچ‌کس موقعیت شما را نمی‌بیند. هشدار اضطراری همچنان کار می‌کند.',
        }),
      ),
      isOn && sharing.viewers.length > 0
        ? el(
            'div.viewer-avatars',
            { ariaLabel: 'کسانی که موقعیت شما را می‌بینند' },
            ...sharing.viewers.slice(0, 4).map((viewer) =>
              el('span.avatar', {
                text: initials(viewer.fullName),
                title: viewer.fullName,
                style: { background: viewer.avatarColor ?? 'var(--accent)' },
              }),
            ),
          )
        : null,
      el('button', {
        class: `btn ${isOn ? 'btn--secondary' : ''}`,
        type: 'button',
        text: isOn ? 'قطع اشتراک' : 'روشن کردن',
        onClick: () => toggleSharing(!isOn),
      }),
    );
  }

  async function toggleSharing(enabled) {
    if (!enabled) {
      const confirmed = await confirmDialog({
        title: 'قطع اشتراک موقعیت؟',
        message:
          'با قطع اشتراک، اعضای خانواده دیگر موقعیت شما را نمی‌بینند و هشدار محدوده هم ارسال نمی‌شود. دکمه‌ی اضطراری همچنان کار می‌کند.',
        confirmLabel: 'بله، قطع کن',
        variant: 'danger',
      });
      if (!confirmed) return;
    }

    try {
      await api.setSharing(enabled);
      toast(
        enabled ? 'اشتراک موقعیت روشن شد' : 'اشتراک موقعیت قطع شد',
        enabled ? 'خانواده دوباره موقعیت شما را می‌بیند.' : 'موقعیت شما دیگر نمایش داده نمی‌شود.',
      );
      await load();
    } catch (error) {
      toast('تغییر وضعیت ناموفق بود', error.message, { severity: 'warning' });
    }
  }

  /* ─────────────────────── کارت وضعیت ─────────────────────── */

  function renderStatusCard() {
    const state = status.status ?? 'unknown';
    const insideNames = status.insideZones.map((z) => z.zoneName).filter(Boolean);
    const location = status.location;

    const detail =
      state === 'inside' && insideNames.length > 0
        ? insideNames.join('، ')
        : state === 'outside'
          ? 'بیرون از همه‌ی محدوده‌های امن'
          : status.zones.length === 0
            ? 'هنوز محدوده‌ی امنی تعریف نشده است'
            : 'در انتظار دریافت موقعیت';

    const battery = batteryLabel(status.batteryLevel);
    const gpsStale = status.gps?.isStale;

    return el(
      'div.status-card',
      { dataStatus: state },
      el('div.status-card__label', { text: 'وضعیت فعلی شما' }),
      el(
        'div.status-card__value',
        {},
        el('span.status-dot', { ariaHidden: 'true' }),
        el('span', { text: STATUS_LABELS[state] ?? STATUS_LABELS.unknown }),
      ),
      el('div.status-card__meta', { text: detail }),
      location
        ? el('div.status-card__meta.text-xs', {
            text: `آخرین به‌روزرسانی: ${faRelativeTime(location.recordedAt)}`,
          })
        : null,
      el(
        'div.chip-row',
        {},
        el('span', {
          class: `chip ${gpsStale ? 'chip--warn' : 'chip--safe'}`,
          text: gpsStale ? '📡 ارتباط GPS قطع است' : '📡 GPS متصل',
        }),
        el('span', {
          class: `chip ${status.batteryLevel !== null && status.batteryLevel <= 15 ? 'chip--warn' : ''}`,
          text: `${battery.icon} باتری ${battery.text}`,
        }),
        el('span', {
          class: `chip ${status.sharing.enabled ? 'chip--accent' : ''}`,
          text: status.sharing.enabled ? '🔗 اشتراک روشن' : '🔒 اشتراک خاموش',
        }),
        location?.isSimulated
          ? el('span.chip.chip--simulated', { text: '🎬 حالت نمایش' })
          : null,
      ),
    );
  }

  /* ─────────────────────── دکمه‌ی SOS ─────────────────────── */

  /**
   * شمارش معکوس سه ثانیه‌ای و قابل لغو.
   * تا پایان شمارش هیچ درخواستی به سرور نمی‌رود — اگر می‌رفت و بعد لغو
   * می‌شد، خانواده یک هشدار قرمز دیده و بی‌جهت وحشت کرده بود.
   */
  async function onSosPressed() {
    haptic([30, 60, 30]);

    let contacts = { count: 0, contacts: [], warning: null };
    try {
      contacts = await api.sosContacts();
    } catch {
      /* اگر خواندن مخاطبان شکست خورد، دکمه باید همچنان کار کند */
    }

    let remaining = 3;
    let cancelled = false;

    const counter = el('div.countdown', { text: faNumber(remaining), ariaLive: 'assertive' });

    const contactsText =
      contacts.count > 0
        ? `${contacts.contacts.map((c) => c.fullName).join('، ')} مطلع می‌شوند.`
        : contacts.warning ?? 'هیچ مخاطب اضطراری ثبت نشده است.';

    const { close } = dialog({
      title: 'ارسال درخواست کمک اضطراری',
      dismissible: false,
      content: el(
        'div',
        {},
        el('p.dialog__text', { text: contactsText }),
        counter,
        el('p.dialog__text', {
          text: 'برای لغو، دکمه‌ی انصراف را بزنید. پس از پایان شمارش، هشدار ارسال می‌شود.',
        }),
      ),
      actions: [
        {
          label: 'انصراف',
          variant: 'secondary',
          onClick: (closeDialog) => {
            cancelled = true;
            clearInterval(timer);
            closeDialog();
            toast('لغو شد', 'هیچ هشداری ارسال نشد.');
          },
        },
      ],
    });

    const timer = setInterval(async () => {
      remaining -= 1;

      if (remaining > 0) {
        counter.textContent = faNumber(remaining);
        haptic(25);
        return;
      }

      clearInterval(timer);
      if (cancelled) return;

      close();
      await sendSos();
    }, 1000);
  }

  async function sendSos() {
    haptic([60, 40, 60, 40, 120]);

    try {
      const location = status?.location;
      const result = await api.triggerSos({
        lat: location?.lat,
        lng: location?.lng,
        batteryLevel: status?.batteryLevel ?? undefined,
        isSimulated: Boolean(location?.isSimulated),
      });

      const count = result.recipients.length;
      toast(
        'درخواست کمک ارسال شد',
        count > 0
          ? `${result.recipients.map((r) => r.fullName).join('، ')} مطلع شدند.`
          : 'هیچ مخاطب اضطراری ثبت نشده بود؛ هشدار فقط ثبت شد.',
        { severity: 'critical' },
      );
    } catch (error) {
      toast('ارسال ناموفق بود', error.message, { severity: 'warning' });
    }
  }

  function renderSosZone() {
    return el(
      'div.sos-zone',
      {},
      el('button.sos-button', {
        type: 'button',
        onClick: onSosPressed,
        ariaLabel: 'ارسال درخواست کمک اضطراری — پس از فشردن، سه ثانیه فرصت لغو دارید',
        text: 'SOS',
      }),
      el('p.sos-hint', {
        text: 'در وضعیت اضطراری این دکمه را فشار دهید. سه ثانیه فرصت لغو دارید.',
      }),
    );
  }

  /* ─────────────────────── نقشه ─────────────────────── */

  function renderMapCard() {
    const mapEl = el('div.map', { id: 'dashboard-map', role: 'application', ariaLabel: 'نقشه‌ی موقعیت شما' });

    const wrap = el(
      'div.map-wrap',
      {},
      mapEl,
      el(
        'div.map-overlay.map-overlay--top',
        {},
        status.location
          ? el('span.map-badge', { text: `🕒 ${faRelativeTime(status.location.recordedAt)}` })
          : null,
        status.location?.isSimulated
          ? el('span.map-badge', { text: '🎬 داده‌ی حالت نمایش' })
          : null,
      ),
    );

    // نقشه باید پس از افزوده شدن به DOM ساخته شود وگرنه ابعادش صفر است
    queueMicrotask(() => {
      if (destroyed || !document.body.contains(mapEl)) return;
      buildMap(mapEl);
    });

    return el(
      'div.card',
      {},
      el(
        'div.card__header',
        {},
        el('h2.card__title', { text: 'موقعیت روی نقشه' }),
        el('div.header-spacer'),
        el('button.btn.btn--secondary.btn--sm', {
          type: 'button',
          text: '↻ به‌روزرسانی',
          onClick: () => load({ silent: false }),
        }),
      ),
      el('div', { style: { padding: 'var(--space-3)' } }, wrap),
    );
  }

  function buildMap(mapEl) {
    map?.destroy();
    map = new SafeMap(mapEl, { zoom: 15 });

    map.setZones(status.zones, { showThresholds: true });

    if (status.location) {
      map.setUserMarker(ctx.user.id, status.location, {
        status: status.status,
        label: ctx.user.fullName,
      });
    }

    map.fitAll();
    map.invalidate();
  }

  /* ─────────────────────── محدوده‌ها ─────────────────────── */

  function renderZonesCard() {
    if (status.zones.length === 0) {
      return el(
        'div.card',
        {},
        el('div.card__body', {},
          el('div.state-block', {},
            el('div.state-block__icon', { text: '📍' }),
            el('h3.state-block__title', { text: 'هنوز محدوده‌ی امنی ندارید' }),
            el('p.state-block__text', {
              text: 'با تعریف محدوده‌ی امن، وقتی از آن خارج شوید خانواده مطلع می‌شود.',
            }),
            el('button.btn', {
              type: 'button',
              text: 'ساخت محدوده‌ی امن',
              onClick: () => ctx.navigate('zones'),
            }),
          ),
        ),
      );
    }

    return el(
      'div.card',
      {},
      el('div.card__header', {},
        el('h2.card__title', { text: 'محدوده‌های امن' }),
        el('div.header-spacer'),
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'مدیریت',
          onClick: () => ctx.navigate('zones'),
        }),
      ),
      el('div.card__body', {},
        ...status.zoneStates.map((zoneState) => {
          const isInside = zoneState.state === 'inside';
          return el('div.list-row', {},
            el('div.alert-icon', { text: isInside ? '🏠' : '📍', ariaHidden: 'true' }),
            el('div.list-row__main', {},
              el('div.list-row__title', { text: zoneState.zoneName }),
              el('div.list-row__sub', {
                text: zoneState.lastDistanceM !== null
                  ? `فاصله: ${faDistance(zoneState.lastDistanceM)} · شعاع: ${faDistance(zoneState.radiusM)}`
                  : `شعاع: ${faDistance(zoneState.radiusM)}`,
              }),
            ),
            el('span', {
              class: `chip ${isInside ? 'chip--safe' : zoneState.state === 'outside' ? 'chip--warn' : ''}`,
              text: isInside ? 'داخل' : zoneState.state === 'outside' ? 'خارج' : 'نامشخص',
            }),
          );
        }),
      ),
    );
  }

  /* ─────────────────────── چیدمان ─────────────────────── */

  function renderAll() {
    if (destroyed) return;

    render(
      container,
      renderSharingBanner(),
      el(
        'div.grid.grid--dashboard',
        {},
        el(
          'div.stack',
          {},
          renderStatusCard(),
          el('div.card', {}, el('div.card__body', {}, renderSosZone())),
          renderZonesCard(),
        ),
        renderMapCard(),
      ),
    );
  }

  function renderLoading() {
    render(
      container,
      el('div.skeleton.skeleton--card.mb-4'),
      el(
        'div.grid.grid--dashboard',
        {},
        el('div.stack', {}, ...skeleton('card', 3)),
        el('div.skeleton.skeleton--map'),
      ),
    );
  }

  /* ─────────────────────── داده ─────────────────────── */

  async function load({ silent = false } = {}) {
    if (!silent) renderLoading();

    try {
      status = await api.ownStatus();
      renderAll();
    } catch (error) {
      render(
        container,
        errorState({
          text: error.message,
          onRetry: () => load(),
        }),
      );
    }
  }

  /* ─────────────────────── رویدادهای زنده ─────────────────────── */

  unsubscribers.push(
    realtime.on(WS_EVENTS.LOCATION_UPDATE, (payload) => {
      if (payload.userId !== ctx.user.id || !status) return;

      status.location = { ...status.location, ...payload };
      status.batteryLevel = payload.batteryLevel ?? status.batteryLevel;

      // نقشه بدون بازسازی کل صفحه به‌روز می‌شود تا حرکت نرم بماند
      map?.setUserMarker(ctx.user.id, payload, {
        status: status.status,
        label: ctx.user.fullName,
      });
    }),
  );

  unsubscribers.push(
    realtime.on(WS_EVENTS.ZONE_STATE, (payload) => {
      if (payload.userId !== ctx.user.id) return;
      load({ silent: true });
    }),
  );

  unsubscribers.push(
    realtime.on(WS_EVENTS.SHARING_CHANGED, (payload) => {
      if (payload.userId !== ctx.user.id) return;
      load({ silent: true });
    }),
  );

  load();

  return () => {
    destroyed = true;
    map?.destroy();
    unsubscribers.forEach((fn) => fn());
  };
}

export default mountDashboard;
