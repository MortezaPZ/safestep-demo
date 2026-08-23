/**
 * داشبورد نظارتی عضو خانواده.
 *
 * سه لایه‌ی اطلاعاتی از بالا به پایین:
 *   ۱) نوار قرمز SOS (فقط وقتی هشدار اضطراری بازی وجود دارد)
 *   ۲) کارت وضعیت هر کاربر تحت مراقبت + نقشه‌ی زنده
 *   ۳) تایم‌لاین هشدارهای اخیر
 *
 * حالت «موقعیت مخفی شد» عمداً یک پیام محترمانه است، نه پیام خطا.
 * کاربر اصلی حق دارد موقعیتش را قطع کند؛ رابط کاربری نباید این را
 * مثل یک نقص یا مقاومت نشان دهد.
 */
import api from '../api.js';
import realtime, { WS_EVENTS } from '../realtime.js';
import SafeMap from '../map.js';
import { el, render, toast, skeleton, emptyState, errorState } from '../ui.js';
import {
  faRelativeTime, faDistance, faNumber, faTime,
  STATUS_LABELS, ALERT_LABELS, initials, batteryLabel,
} from '../format.js';

export function mountGuardian(container, ctx) {
  let watching = [];
  let alerts = [];
  let activeSos = null;
  let map = null;
  let destroyed = false;
  const unsubscribers = [];

  /* ─────────────────────── نوار SOS ─────────────────────── */

  function renderSosStrip() {
    if (!activeSos) return null;

    const subjectName = activeSos.subject?.fullName ?? 'کاربر';

    return el(
      'div.sos-strip',
      { role: 'alert' },
      el('span', { text: '🆘', style: { fontSize: '2rem' }, ariaHidden: 'true' }),
      el(
        'div',
        { style: { flex: '1', minWidth: '200px' } },
        el('div.sos-strip__title', { text: `${subjectName} درخواست کمک کرده است` }),
        el('div.sos-strip__text', {
          text: `${faRelativeTime(activeSos.createdAt)} · ساعت ${faTime(activeSos.createdAt)}`,
        }),
        activeSos.metadata?.note
          ? el('div.sos-strip__text', { text: `یادداشت: «${activeSos.metadata.note}»` })
          : null,
        activeSos.metadata?.isStaleLocation
          ? el('div.sos-strip__text', { text: '⚠️ موقعیت نمایش‌داده‌شده قدیمی است.' })
          : null,
      ),
      el('button.btn', {
        type: 'button',
        text: '📞 تماس',
        onClick: () => {
          const phone = watching.find((w) => w.user?.id === activeSos.userId)?.user?.phone;
          if (phone) window.location.href = `tel:${phone}`;
          else toast('شماره در دسترس نیست', 'شماره تماس این کاربر ثبت نشده است.', { severity: 'warning' });
        },
      }),
      el('button.btn', {
        type: 'button',
        text: 'نمایش روی نقشه',
        onClick: () => {
          if (activeSos.lat && activeSos.lng) {
            map?.panTo({ lat: activeSos.lat, lng: activeSos.lng }, 17);
          }
        },
      }),
      el('button.btn', {
        type: 'button',
        text: '✓ رسیدگی شد',
        onClick: async () => {
          try {
            await api.resolveAlert(activeSos.id);
            activeSos = null;
            toast('هشدار بسته شد', 'وضعیت اضطراری رسیدگی‌شده علامت خورد.');
            await load({ silent: true });
          } catch (error) {
            toast('عملیات ناموفق بود', error.message, { severity: 'warning' });
          }
        },
      }),
    );
  }

  /* ─────────────────────── کارت هر کاربر ─────────────────────── */

  function renderWatchCard(entry) {
    const user = entry.user ?? {};

    if (entry.hidden) {
      return el(
        'div.card',
        {},
        el('div.card__body', {},
          el('div.row.row--between.row--wrap.mb-4', {},
            el('div.row', {},
              el('span.avatar.avatar--lg', {
                text: initials(user.fullName),
                style: { background: user.avatarColor ?? 'var(--accent)' },
              }),
              el('div', {},
                el('div.list-row__title', { text: user.fullName }),
                el('div.list-row__sub', { text: 'موقعیت مخفی است' }),
              ),
            ),
            el('span', {
              class: `chip ${entry.isOnline ? 'chip--safe' : ''}`,
              text: entry.isOnline ? '● آنلاین' : '○ آفلاین',
            }),
          ),
          el('div.hidden-location', {},
            el('div', { text: '🙈', style: { fontSize: '2rem' } }),
            el('h3.state-block__title', { text: 'موقعیت مخفی شد' }),
            el('p.state-block__text', {
              text: entry.message ?? 'کاربر اشتراک‌گذاری موقعیت را موقتاً خاموش کرده است.',
            }),
            el('p.text-xs.text-muted', {
              text: 'در صورت فشردن دکمه‌ی اضطراری، همچنان مطلع می‌شوید.',
            }),
          ),
        ),
      );
    }

    const state = entry.status?.status ?? 'unknown';
    const location = entry.location;
    const battery = batteryLabel(location?.batteryLevel);
    const insideNames = (entry.status?.insideZones ?? [])
      .map((z) => z.zoneName)
      .filter(Boolean);

    return el(
      'div.status-card',
      { dataStatus: state },
      el('div.row.row--between.row--wrap', {},
        el('div.row', {},
          el('span.avatar.avatar--lg', {
            text: initials(user.fullName),
            style: { background: user.avatarColor ?? 'var(--accent)' },
          }),
          el('div', {},
            el('div.status-card__value', { style: { fontSize: 'var(--text-lg)' } },
              el('span.status-dot', { ariaHidden: 'true' }),
              el('span', { text: user.fullName }),
            ),
            el('div.status-card__meta', {
              text: state === 'inside' && insideNames.length > 0
                ? `${STATUS_LABELS.inside} — ${insideNames.join('، ')}`
                : STATUS_LABELS[state] ?? STATUS_LABELS.unknown,
            }),
          ),
        ),
        el('span', {
          class: `chip ${entry.isOnline ? 'chip--safe' : ''}`,
          text: entry.isOnline ? '● آنلاین' : '○ آفلاین',
        }),
      ),
      el('div.chip-row', {},
        location
          ? el('span.chip', { text: `🕒 ${faRelativeTime(location.recordedAt)}` })
          : el('span.chip.chip--warn', { text: 'موقعیتی ثبت نشده' }),
        entry.gps?.isStale ? el('span.chip.chip--warn', { text: '📡 ارتباط قطع است' }) : null,
        location?.batteryLevel !== null && location?.batteryLevel !== undefined
          ? el('span', {
              class: `chip ${location.batteryLevel <= 15 ? 'chip--warn' : ''}`,
              text: `${battery.icon} ${battery.text}`,
            })
          : null,
        location?.isSimulated ? el('span.chip.chip--simulated', { text: '🎬 حالت نمایش' }) : null,
        ...(entry.permissions ?? []).map((permission) =>
          el('span.chip.chip--accent', {
            text: permission === 'emergency' ? '🔑 دسترسی اضطراری' : permission === 'view_location' ? '📍 مشاهده' : '🔔 هشدار',
          }),
        ),
      ),
      el('div.row.mt-4', {},
        el('button.btn.btn--secondary.btn--sm', {
          type: 'button',
          text: 'نمایش روی نقشه',
          onClick: () => location && map?.panTo(location, 17),
        }),
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'تاریخچه‌ی مسیر',
          onClick: () => ctx.navigate('history', { userId: user.id }),
        }),
      ),
    );
  }

  /* ─────────────────────── نقشه ─────────────────────── */

  function renderMapCard() {
    const mapEl = el('div.map', {
      id: 'guardian-map',
      role: 'application',
      ariaLabel: 'نقشه‌ی زنده‌ی اعضای تحت مراقبت',
    });

    const visible = watching.filter((w) => !w.hidden && w.location);

    const wrap = el(
      'div.map-wrap',
      {},
      mapEl,
      el(
        'div.map-overlay.map-overlay--top',
        {},
        el('span.map-badge', {
          text: `👥 ${faNumber(visible.length)} نفر روی نقشه`,
        }),
        visible.some((w) => w.location?.isSimulated)
          ? el('span.map-badge', { text: '🎬 داده‌ی حالت نمایش' })
          : null,
      ),
    );

    queueMicrotask(() => {
      if (destroyed || !document.body.contains(mapEl)) return;
      buildMap(mapEl);
    });

    return el(
      'div.card',
      {},
      el('div.card__header', {},
        el('h2.card__title', { text: 'نقشه‌ی زنده' }),
        el('div.header-spacer'),
        el('button.btn.btn--secondary.btn--sm', {
          type: 'button',
          text: '↻ به‌روزرسانی',
          onClick: () => load(),
        }),
      ),
      el('div', { style: { padding: 'var(--space-3)' } }, wrap),
    );
  }

  function buildMap(mapEl) {
    map?.destroy();
    map = new SafeMap(mapEl, { zoom: 14 });

    const allZones = [];

    for (const entry of watching) {
      if (entry.hidden || !entry.location) continue;

      map.setUserMarker(entry.user.id, entry.location, {
        status: entry.status?.status,
        label: entry.user.fullName,
      });

      // محدوده‌های امن از وضعیت هر کاربر استخراج می‌شوند
      for (const zoneState of entry.zones ?? []) {
        if (zoneState.zoneName) {
          allZones.push({
            id: zoneState.zoneId,
            name: zoneState.zoneName,
            centerLat: entry.location.lat,
            centerLng: entry.location.lng,
            radiusM: zoneState.radiusM,
          });
        }
      }
    }

    map.fitAll();
    map.invalidate();
  }

  /* ─────────────────────── تایم‌لاین هشدارها ─────────────────────── */

  function renderAlertTimeline() {
    if (alerts.length === 0) {
      return el(
        'div.card',
        {},
        el('div.card__header', {}, el('h2.card__title', { text: 'هشدارهای اخیر' })),
        el('div.card__body', {},
          emptyState({
            icon: '✅',
            title: 'هشداری ثبت نشده',
            text: 'همه‌چیز آرام است. هر رویدادی که پیش بیاید همین‌جا نمایش داده می‌شود.',
          }),
        ),
      );
    }

    return el(
      'div.card',
      {},
      el('div.card__header', {},
        el('h2.card__title', { text: 'هشدارهای اخیر' }),
        el('div.header-spacer'),
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'همه‌ی هشدارها',
          onClick: () => ctx.navigate('alerts'),
        }),
      ),
      el('div.card__body', {},
        el('div.alert-list', {},
          ...alerts.slice(0, 6).map((alert) => renderAlertRow(alert)),
        ),
      ),
    );
  }

  function renderAlertRow(alert, isNew = false) {
    const meta = ALERT_LABELS[alert.type] ?? { label: alert.type, icon: '🔔' };

    return el(
      'div',
      {
        class: `alert-item ${isNew ? 'alert-item--new' : ''}`,
        dataSeverity: alert.severity,
        dataUnread: String(!alert.isRead),
      },
      el('div.alert-icon', { dataSeverity: alert.severity, text: meta.icon, ariaHidden: 'true' }),
      el('div.alert-body', {},
        el('div.alert-title', {},
          el('span', { text: alert.title }),
          alert.resolvedAt ? el('span.chip.chip--safe', { text: 'رسیدگی شد' }) : null,
          alert.metadata?.isSimulated ? el('span.chip.chip--simulated', { text: 'نمایش' }) : null,
        ),
        el('div.alert-text', { text: alert.body }),
        el('div.alert-meta', {},
          el('span', { text: faRelativeTime(alert.createdAt) }),
          el('span', { text: `ساعت ${faTime(alert.createdAt)}` }),
          alert.metadata?.distanceM
            ? el('span', { text: `فاصله: ${faDistance(alert.metadata.distanceM)}` })
            : null,
        ),
      ),
    );
  }

  /* ─────────────────────── چیدمان ─────────────────────── */

  function renderAll() {
    if (destroyed) return;

    if (watching.length === 0) {
      render(
        container,
        el('div.card', {},
          el('div.card__body', {},
            emptyState({
              icon: '🔗',
              title: 'هنوز به کسی متصل نیستید',
              text: 'کد دعوت ۶ رقمی را از فرد مورد نظر بگیرید و وارد کنید تا موقعیت و هشدارهای او را ببینید.',
              action: { label: 'وارد کردن کد دعوت', onClick: () => ctx.navigate('family') },
            }),
          ),
        ),
      );
      return;
    }

    render(
      container,
      renderSosStrip(),
      el(
        'div.grid.grid--dashboard',
        {},
        el('div.stack', {}, ...watching.map(renderWatchCard)),
        el('div.stack', {}, renderMapCard(), renderAlertTimeline()),
      ),
    );
  }

  function renderLoading() {
    render(
      container,
      el('div.grid.grid--dashboard', {},
        el('div.stack', {}, ...skeleton('card', 2)),
        el('div.stack', {}, el('div.skeleton.skeleton--map'), ...skeleton('row', 3)),
      ),
    );
  }

  /* ─────────────────────── داده ─────────────────────── */

  async function load({ silent = false } = {}) {
    if (!silent) renderLoading();

    try {
      const [watchResult, alertResult] = await Promise.all([
        api.watchList(),
        api.alerts({ limit: 20 }),
      ]);

      watching = watchResult.watching ?? [];
      alerts = alertResult.alerts ?? [];

      // هشدار اضطراری بازِ هر یک از کاربران تحت مراقبت
      activeSos =
        alerts.find((a) => a.type === 'sos' && !a.resolvedAt) ?? null;

      renderAll();
    } catch (error) {
      render(container, errorState({ text: error.message, onRetry: () => load() }));
    }
  }

  /* ─────────────────────── رویدادهای زنده ─────────────────────── */

  unsubscribers.push(
    realtime.on(WS_EVENTS.LOCATION_UPDATE, (payload) => {
      const entry = watching.find((w) => w.user?.id === payload.userId);
      if (!entry) return;

      entry.location = { ...entry.location, ...payload };
      entry.hidden = payload.sharingEnabled === false;

      // فقط نشانگر جابه‌جا می‌شود؛ بازسازی کل صفحه، حرکت را تکه‌تکه می‌کرد
      if (!entry.hidden) {
        map?.setUserMarker(payload.userId, payload, {
          status: entry.status?.status,
          label: entry.user.fullName,
        });
      }
    }),
  );

  unsubscribers.push(
    realtime.on(WS_EVENTS.ALERT_NEW, (alert) => {
      if (alert.isResolution) {
        if (activeSos?.id === alert.id) activeSos = null;
        load({ silent: true });
        return;
      }

      alerts = [alert, ...alerts];
      if (alert.type === 'sos' && !alert.resolvedAt) activeSos = alert;

      renderAll();

      // اولین ردیف تایم‌لاین یک بار می‌تپد تا هشدار تازه دیده شود
      const firstRow = container.querySelector('.alert-list .alert-item');
      firstRow?.classList.add('alert-item--new');
    }),
  );

  unsubscribers.push(
    realtime.on(WS_EVENTS.SHARING_CHANGED, () => load({ silent: true })),
  );

  unsubscribers.push(
    realtime.on(WS_EVENTS.ZONE_STATE, () => load({ silent: true })),
  );

  load();

  return () => {
    destroyed = true;
    map?.destroy();
    unsubscribers.forEach((fn) => fn());
  };
}

export default mountGuardian;
