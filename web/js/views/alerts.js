/**
 * صفحه‌ی هشدارها با فیلتر بر اساس نوع و وضعیت خوانده‌شدن.
 *
 * هر نوع هشدار آیکون و رنگ اختصاصی دارد، اما رنگ هرگز تنها حامل معنا نیست:
 * عنوان متنی همیشه کنارش هست. برای کاربر کوررنگ یا کسی که با صفحه‌خوان
 * کار می‌کند، رنگِ تنها یعنی هیچ.
 */
import api from '../api.js';
import realtime, { WS_EVENTS } from '../realtime.js';
import { el, render, toast, skeleton, emptyState, errorState } from '../ui.js';
import {
  faRelativeTime, faTime, faDate, faDistance, faDuration, faNumber, faDayLabel,
  ALERT_LABELS,
} from '../format.js';

const FILTER_ORDER = ['sos', 'zone_exit', 'zone_enter', 'long_stop', 'gps_lost', 'low_battery'];

export function mountAlerts(container, ctx) {
  let alerts = [];
  let countsByType = {};
  let unreadCount = 0;
  let activeTypes = new Set();
  let unreadOnly = false;
  let destroyed = false;
  const unsubscribers = [];

  /* ─────────────────────── فیلترها ─────────────────────── */

  function renderFilters() {
    const total = Object.values(countsByType).reduce((sum, n) => sum + n, 0);

    return el(
      'div.card.mb-4',
      {},
      el('div.card__body', {},
        el('div.row.row--between.row--wrap.mb-4', {},
          el('h2.card__title', { text: 'فیلتر هشدارها' }),
          unreadCount > 0
            ? el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: `علامت‌گذاری همه به‌عنوان خوانده‌شده (${faNumber(unreadCount)})`,
                onClick: markAllRead,
              })
            : null,
        ),
        el('div.chip-row', { role: 'group', ariaLabel: 'فیلتر بر اساس نوع هشدار' },
          el('button', {
            class: 'chip chip--button',
            type: 'button',
            ariaPressed: String(activeTypes.size === 0 && !unreadOnly),
            text: `همه (${faNumber(total)})`,
            onClick: () => {
              activeTypes.clear();
              unreadOnly = false;
              load();
            },
          }),
          el('button', {
            class: 'chip chip--button',
            type: 'button',
            ariaPressed: String(unreadOnly),
            text: `نخوانده (${faNumber(unreadCount)})`,
            onClick: () => {
              unreadOnly = !unreadOnly;
              load();
            },
          }),
          ...FILTER_ORDER.filter((type) => countsByType[type]).map((type) => {
            const meta = ALERT_LABELS[type];
            return el('button', {
              class: 'chip chip--button',
              type: 'button',
              ariaPressed: String(activeTypes.has(type)),
              text: `${meta.icon} ${meta.label} (${faNumber(countsByType[type])})`,
              onClick: () => {
                if (activeTypes.has(type)) activeTypes.delete(type);
                else activeTypes.add(type);
                load();
              },
            });
          }),
        ),
      ),
    );
  }

  /* ─────────────────────── ردیف هشدار ─────────────────────── */

  function renderAlertItem(alert) {
    const meta = ALERT_LABELS[alert.type] ?? { label: alert.type, icon: '🔔' };
    const isOwn = alert.userId === ctx.user.id;

    const details = [];
    if (alert.metadata?.distanceM) {
      details.push(`فاصله از مرکز: ${faDistance(alert.metadata.distanceM)}`);
    }
    if (alert.metadata?.radiusM) {
      details.push(`شعاع محدوده: ${faDistance(alert.metadata.radiusM)}`);
    }
    if (alert.metadata?.durationMinutes) {
      details.push(`مدت توقف: ${faDuration(alert.metadata.durationMinutes)}`);
    }
    if (alert.metadata?.dispersionM) {
      details.push(`پراکندگی: ${faDistance(alert.metadata.dispersionM)}`);
    }
    if (alert.metadata?.batteryLevel !== undefined && alert.metadata?.batteryLevel !== null) {
      details.push(`باتری: ${faNumber(alert.metadata.batteryLevel)}٪`);
    }
    if (alert.metadata?.locationSource === 'last_known') {
      details.push('موقعیت: آخرین نقطه‌ی شناخته‌شده');
    }

    return el(
      'div.alert-item',
      {
        dataSeverity: alert.severity,
        dataUnread: String(!alert.isRead),
        dataAlertId: alert.id,
      },
      el('div.alert-icon', { dataSeverity: alert.severity, text: meta.icon, ariaHidden: 'true' }),
      el('div.alert-body', {},
        el('div.alert-title', {},
          el('span', { text: alert.title }),
          alert.resolvedAt ? el('span.chip.chip--safe', { text: '✓ رسیدگی شد' }) : null,
          alert.metadata?.isSimulated
            ? el('span.chip.chip--simulated', { text: '🎬 حالت نمایش' })
            : null,
          !isOwn && alert.subject
            ? el('span.chip', { text: alert.subject.fullName })
            : null,
        ),
        el('div.alert-text', { text: alert.body }),
        alert.metadata?.note
          ? el('div.alert-text', { text: `یادداشت: «${alert.metadata.note}»` })
          : null,
        el('div.alert-meta', {},
          el('span', { text: faRelativeTime(alert.createdAt) }),
          el('span', { text: `${faDate(alert.createdAt)} · ${faTime(alert.createdAt)}` }),
          ...details.map((d) => el('span', { text: d })),
        ),
        el('div.alert-actions', {},
          !alert.isRead
            ? el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'خواندم',
                onClick: () => markRead(alert),
              })
            : null,
          !alert.resolvedAt && alert.type === 'sos'
            ? el('button.btn.btn--secondary.btn--sm', {
                type: 'button',
                text: '✓ رسیدگی شد',
                onClick: () => resolve(alert),
              })
            : null,
          alert.lat && alert.lng
            ? el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'روی نقشه',
                onClick: () => ctx.navigate('history', { userId: alert.userId, focus: alert }),
              })
            : null,
        ),
      ),
    );
  }

  /** گروه‌بندی بر اساس روز — تایم‌لاین بدون سرفصل روز خوانا نیست. */
  function groupByDay(items) {
    const groups = new Map();

    for (const alert of items) {
      const key = new Date(alert.createdAt).toDateString();
      if (!groups.has(key)) groups.set(key, { label: faDayLabel(alert.createdAt), items: [] });
      groups.get(key).items.push(alert);
    }

    return [...groups.values()];
  }

  /* ─────────────────────── کنش‌ها ─────────────────────── */

  async function markRead(alert) {
    try {
      await api.markAlertRead(alert.id);
      alert.isRead = true;
      unreadCount = Math.max(0, unreadCount - 1);
      ctx.setUnreadCount?.(unreadCount);
      renderAll();
    } catch (error) {
      toast('عملیات ناموفق بود', error.message, { severity: 'warning' });
    }
  }

  async function markAllRead() {
    try {
      const result = await api.markAllAlertsRead();
      toast('انجام شد', `${faNumber(result.count)} هشدار خوانده‌شده علامت خورد.`);
      await load();
    } catch (error) {
      toast('عملیات ناموفق بود', error.message, { severity: 'warning' });
    }
  }

  async function resolve(alert) {
    try {
      await api.resolveAlert(alert.id);
      toast('هشدار بسته شد');
      await load();
    } catch (error) {
      toast('عملیات ناموفق بود', error.message, { severity: 'warning' });
    }
  }

  /* ─────────────────────── چیدمان ─────────────────────── */

  function renderAll() {
    if (destroyed) return;

    const body =
      alerts.length === 0
        ? el('div.card', {}, el('div.card__body', {},
            emptyState({
              icon: activeTypes.size > 0 || unreadOnly ? '🔍' : '✅',
              title: activeTypes.size > 0 || unreadOnly ? 'موردی با این فیلتر پیدا نشد' : 'هیچ هشداری ثبت نشده',
              text: activeTypes.size > 0 || unreadOnly
                ? 'فیلترها را تغییر دهید یا حذف کنید.'
                : 'همه‌چیز آرام است. هر رویدادی پیش بیاید همین‌جا ثبت می‌شود.',
              action: activeTypes.size > 0 || unreadOnly
                ? { label: 'حذف فیلترها', onClick: () => { activeTypes.clear(); unreadOnly = false; load(); } }
                : null,
            }),
          ))
        : el('div.stack', {},
            ...groupByDay(alerts).map((group) =>
              el('div', {},
                el('h3.text-sm.text-muted.mb-4', { text: group.label }),
                el('div.alert-list', {}, ...group.items.map(renderAlertItem)),
              ),
            ),
          );

    render(container, renderFilters(), body);
  }

  async function load() {
    if (!destroyed && container.childElementCount === 0) {
      render(container, ...skeleton('row', 5));
    }

    try {
      const result = await api.alerts({
        types: activeTypes.size > 0 ? [...activeTypes].join(',') : undefined,
        unreadOnly: unreadOnly ? 'true' : undefined,
        limit: 200,
      });

      alerts = result.alerts ?? [];
      countsByType = result.countsByType ?? {};
      unreadCount = result.unreadCount ?? 0;
      ctx.setUnreadCount?.(unreadCount);

      renderAll();
    } catch (error) {
      render(container, errorState({ text: error.message, onRetry: load }));
    }
  }

  unsubscribers.push(
    realtime.on(WS_EVENTS.ALERT_NEW, () => load()),
  );

  load();

  return () => {
    destroyed = true;
    unsubscribers.forEach((fn) => fn());
  };
}

export default mountAlerts;
