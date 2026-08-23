/**
 * صفحه‌ی تنظیمات.
 *
 * تنظیمات از بالا به پایین بر اساس اثرشان بر حریم خصوصی مرتب شده‌اند:
 * اول اشتراک‌گذاری موقعیت (بیشترین اثر)، بعد انواع هشدار، بعد آستانه‌ها،
 * و در انتها ترجیحات ظاهری.
 */
import api from '../api.js';
import { el, render, toast, confirmDialog, skeleton, errorState, getTheme, applyTheme, THEME_LABELS } from '../ui.js';
import { faNumber, faDistance, faDuration, ALERT_LABELS } from '../format.js';

const CONFIGURABLE_ALERTS = ['zone_exit', 'long_stop', 'gps_lost', 'low_battery'];

export function mountSettings(container, ctx) {
  let settings = null;
  let health = null;
  let destroyed = false;

  /* ─────────────────────── کنترل‌های پایه ─────────────────────── */

  function switchRow({ title, description, checked, onChange, disabled = false }) {
    const input = el('input', {
      type: 'checkbox',
      checked: checked ? 'checked' : null,
      disabled: disabled ? 'disabled' : null,
      onChange: (event) => onChange(event.target.checked),
    });

    return el('div.list-row', {},
      el('div.list-row__main', {},
        el('div.list-row__title', { text: title }),
        description ? el('div.list-row__sub', { text: description }) : null,
      ),
      el('label.switch', {},
        input,
        el('span.switch__track', {}, el('span.switch__thumb')),
      ),
    );
  }

  async function patch(changes, successMessage) {
    try {
      const result = await api.updateSettings(changes);
      settings = result.settings;
      ctx.updateSettings?.(settings);
      if (successMessage) toast('ذخیره شد', successMessage);
      renderAll();
    } catch (error) {
      toast('ذخیره ناموفق بود', error.message, { severity: 'warning' });
      renderAll();
    }
  }

  /* ─────────────────────── حریم خصوصی ─────────────────────── */

  function renderPrivacyCard() {
    return el('div.card', {},
      el('div.card__header', {}, el('h2.card__title', { text: 'حریم خصوصی و اشتراک‌گذاری' })),
      el('div.card__body', {},
        switchRow({
          title: 'اشتراک‌گذاری موقعیت',
          description: settings.locationSharingEnabled
            ? 'اعضای خانواده موقعیت زنده‌ی شما را می‌بینند. با خاموش کردن، همه‌چیز جز دکمه‌ی اضطراری متوقف می‌شود.'
            : 'خاموش است. هیچ‌کس موقعیت شما را نمی‌بیند. دکمه‌ی اضطراری همچنان کار می‌کند.',
          checked: settings.locationSharingEnabled,
          onChange: async (enabled) => {
            if (!enabled) {
              const confirmed = await confirmDialog({
                title: 'قطع اشتراک موقعیت؟',
                message: 'اعضای خانواده دیگر موقعیت شما را نمی‌بینند و هشدار محدوده ارسال نمی‌شود.',
                confirmLabel: 'بله، قطع کن',
              });
              if (!confirmed) {
                renderAll();
                return;
              }
            }
            await patch({ locationSharingEnabled: enabled });
          },
        }),

        el('div.list-row', {},
          el('div.list-row__main', {},
            el('div.list-row__title', { text: 'حذف کامل تاریخچه‌ی مسیر' }),
            el('div.list-row__sub', {
              text: 'تمام نقاط ثبت‌شده برای همیشه از دیتابیس پاک می‌شوند — نه اینکه فقط مخفی شوند.',
            }),
          ),
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'حذف همه',
            onClick: async () => {
              const confirmed = await confirmDialog({
                title: 'حذف کل تاریخچه؟',
                message: 'همه‌ی مسیرهای ثبت‌شده‌ی شما پاک می‌شوند. این کار قابل بازگشت نیست.',
                confirmLabel: 'بله، همه را پاک کن',
              });
              if (!confirmed) return;

              try {
                const result = await api.deleteHistory();
                toast('حذف شد', `${faNumber(result.deleted)} نقطه از دیتابیس پاک شد.`);
              } catch (error) {
                toast('حذف ناموفق بود', error.message, { severity: 'warning' });
              }
            },
          }),
        ),
      ),
    );
  }

  /* ─────────────────────── هشدارها ─────────────────────── */

  function renderAlertsCard() {
    return el('div.card', {},
      el('div.card__header', {}, el('h2.card__title', { text: 'هشدارها' })),
      el('div.card__body', {},
        el('p.text-xs.text-muted.mb-4', {
          text: 'انتخاب کنید کدام رویدادها به خانواده اطلاع داده شود. هشدار اضطراری همیشه فعال است و قابل خاموش کردن نیست.',
        }),

        ...CONFIGURABLE_ALERTS.map((type) => {
          const meta = ALERT_LABELS[type];
          return switchRow({
            title: `${meta.icon} ${meta.label}`,
            checked: settings.alertTypes.includes(type),
            onChange: (enabled) => {
              const next = new Set(settings.alertTypes);
              if (enabled) next.add(type);
              else next.delete(type);
              patch({ alertTypes: [...next] });
            },
          });
        }),

        el('div.list-row', {},
          el('div.list-row__main', {},
            el('div.list-row__title', { text: '🆘 درخواست کمک اضطراری' }),
            el('div.list-row__sub', { text: 'همیشه فعال — این هشدار قابل غیرفعال کردن نیست.' }),
          ),
          el('span.chip.chip--danger', { text: 'همیشه روشن' }),
        ),
      ),
    );
  }

  /* ─────────────────────── آستانه‌ی توقف طولانی ─────────────────────── */

  function renderStopCard() {
    const minutesValue = el('span.font-bold', { text: faDuration(settings.longStopMinutes) });
    const radiusValue = el('span.font-bold', { text: faDistance(settings.longStopRadiusM) });

    const minutesSlider = el('input.slider', {
      type: 'range',
      min: '5',
      max: '120',
      step: '5',
      value: String(settings.longStopMinutes),
      ariaLabel: 'مدت توقف تا صدور هشدار',
    });

    const radiusSlider = el('input.slider', {
      type: 'range',
      min: '10',
      max: '200',
      step: '5',
      value: String(settings.longStopRadiusM),
      ariaLabel: 'شعاع پراکندگی برای تشخیص توقف',
    });

    minutesSlider.addEventListener('input', () => {
      minutesValue.textContent = faDuration(Number(minutesSlider.value));
    });
    minutesSlider.addEventListener('change', () => {
      patch({ longStopMinutes: Number(minutesSlider.value) }, 'آستانه‌ی توقف به‌روزرسانی شد.');
    });

    radiusSlider.addEventListener('input', () => {
      radiusValue.textContent = faDistance(Number(radiusSlider.value));
    });
    radiusSlider.addEventListener('change', () => {
      patch({ longStopRadiusM: Number(radiusSlider.value) }, 'شعاع تشخیص توقف به‌روزرسانی شد.');
    });

    return el('div.card', {},
      el('div.card__header', {}, el('h2.card__title', { text: 'تشخیص توقف طولانی' })),
      el('div.card__body', {},
        el('p.text-xs.text-muted.mb-4', {
          text: 'اگر تمام موقعیت‌های ثبت‌شده در بازه‌ی زیر درون دایره‌ای با شعاع تعیین‌شده بمانند، توقف طولانی گزارش می‌شود.',
        }),
        el('div.field', {},
          el('label.field__label', {}, 'مدت توقف: ', minutesValue),
          minutesSlider,
        ),
        el('div.field', {},
          el('label.field__label', {}, 'شعاع پراکندگی: ', radiusValue),
          radiusSlider,
        ),
      ),
    );
  }

  /* ─────────────────────── ظاهر و سیستم ─────────────────────── */

  function renderAppearanceCard() {
    const current = getTheme();

    return el('div.card', {},
      el('div.card__header', {}, el('h2.card__title', { text: 'ظاهر' })),
      el('div.card__body', {},
        el('div.field', {},
          el('label.field__label', { text: 'تم' }),
          el('div.chip-row', {},
            ...['system', 'light', 'dark'].map((theme) =>
              el('button', {
                class: 'chip chip--button',
                type: 'button',
                ariaPressed: String(theme === current),
                text: THEME_LABELS[theme],
                onClick: () => {
                  applyTheme(theme);
                  renderAll();
                },
              }),
            ),
          ),
        ),
        el('div.field', {},
          el('label.field__label', { text: 'زبان' }),
          el('div.chip-row', {},
            el('span.chip.chip--accent', { text: 'فارسی' }),
            el('span.chip', { text: 'English (به‌زودی)' }),
          ),
        ),
      ),
    );
  }

  function renderSystemCard() {
    if (!health) return null;

    return el('div.card', {},
      el('div.card__header', {}, el('h2.card__title', { text: 'وضعیت سامانه' })),
      el('div.card__body', {},
        el('div.stat-grid', {},
          el('div.stat', {},
            el('div.stat__value', { text: health.database?.ok ? '✓' : '✕' }),
            el('div.stat__label', {
              text: health.database?.driver === 'pglite' ? 'دیتابیس درون‌پردازه‌ای' : 'دیتابیس شبکه‌ای',
            }),
          ),
          el('div.stat', {},
            el('div.stat__value', { text: health.notifications?.driver === 'fcm' ? 'FCM' : 'محلی' }),
            el('div.stat__label', { text: 'مسیر نوتیفیکیشن' }),
          ),
          el('div.stat', {},
            el('div.stat__value.tabular', { text: faNumber(health.realtime?.connectedUsers ?? 0) }),
            el('div.stat__label', { text: 'کاربر متصل' }),
          ),
          el('div.stat', {},
            el('div.stat__value', { text: health.demoMode ? 'فعال' : 'خاموش' }),
            el('div.stat__label', { text: 'حالت نمایش' }),
          ),
        ),
        health.notifications?.note
          ? el('p.text-xs.text-muted.mt-4', { text: health.notifications.note })
          : null,
      ),
    );
  }

  /* ─────────────────────── چیدمان ─────────────────────── */

  function renderAll() {
    if (destroyed || !settings) return;

    render(
      container,
      el('div.stack', {},
        renderPrivacyCard(),
        renderAlertsCard(),
        renderStopCard(),
        renderAppearanceCard(),
        renderSystemCard(),
        el('div.card', {},
          el('div.card__body', {},
            el('button.btn.btn--secondary.btn--block', {
              type: 'button',
              text: 'خروج از حساب',
              onClick: async () => {
                const confirmed = await confirmDialog({
                  title: 'خروج از حساب؟',
                  message: 'برای ورود دوباره به شماره و رمز عبور نیاز دارید.',
                  confirmLabel: 'خروج',
                  variant: 'danger',
                });
                if (confirmed) ctx.logout();
              },
            }),
          ),
        ),
      ),
    );
  }

  async function load() {
    render(container, ...skeleton('card', 3));

    try {
      const [settingsResult, healthResult] = await Promise.all([
        api.settings(),
        api.health().catch(() => null),
      ]);

      settings = settingsResult.settings;
      health = healthResult;

      renderAll();
    } catch (error) {
      render(container, errorState({ text: error.message, onRetry: load }));
    }
  }

  load();

  return () => {
    destroyed = true;
  };
}

export default mountSettings;
