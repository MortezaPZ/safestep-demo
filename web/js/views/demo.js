/**
 * پنل حالت نمایش (شبیه‌ساز موقعیت).
 *
 * این صفحه عمداً با رنگ بنفش و برچسب صریح از بقیه‌ی اپ متمایز شده است.
 * هدف، صداقت است: بیننده‌ی دمو باید در هر لحظه بداند که موقعیت از
 * شبیه‌ساز می‌آید، نه از GPS واقعی.
 *
 * مهم: پینگ‌های شبیه‌سازی‌شده از همان API واقعی عبور می‌کنند. یعنی
 * موتور Geofence، تشخیص توقف و توزیع هشدار همگی واقعاً اجرا می‌شوند —
 * تنها منبع مختصات ساختگی است.
 */
import api from '../api.js';
import realtime, { WS_EVENTS } from '../realtime.js';
import { el, render, toast, skeleton, errorState } from '../ui.js';
import { faNumber, faPercent } from '../format.js';

export function mountDemo(container, ctx) {
  let routes = [];
  let status = { running: false };
  let selectedRoute = 'exitZone';
  let speed = 8;
  let destroyed = false;
  const unsubscribers = [];

  /* ─────────────────────── کنترل‌ها ─────────────────────── */

  async function start() {
    try {
      status = await api.startSimulator({
        routeId: selectedRoute,
        speedMultiplier: speed,
        batteryLevel: 78,
      });

      const route = routes.find((r) => r.id === selectedRoute);
      toast('شبیه‌سازی آغاز شد', route?.expectedOutcome ?? '');
      renderAll();
    } catch (error) {
      toast('شروع ناموفق بود', error.message, { severity: 'warning' });
    }
  }

  async function stop() {
    try {
      status = await api.stopSimulator();
      toast('شبیه‌سازی متوقف شد');
      renderAll();
    } catch (error) {
      toast('توقف ناموفق بود', error.message, { severity: 'warning' });
    }
  }

  /* ─────────────────────── چیدمان ─────────────────────── */

  function renderRouteOption(route) {
    return el('button.route-option', {
      type: 'button',
      ariaPressed: String(route.id === selectedRoute),
      disabled: status.running ? 'disabled' : null,
      onClick: () => {
        selectedRoute = route.id;
        renderAll();
      },
    },
      el('div.route-option__name', { text: route.name }),
      el('div.route-option__desc', { text: route.description }),
      el('div.route-option__outcome', { text: `نتیجه‌ی مورد انتظار: ${route.expectedOutcome}` }),
    );
  }

  function renderRunningPanel() {
    return el('div.stack--sm', {},
      el('div.row.row--between.row--wrap', {},
        el('div', {},
          el('div.list-row__title', { text: `در حال پخش: ${status.routeName}` }),
          // کلاس اختصاصی دارند تا به‌روزرسانی زنده به ترتیب المان‌ها وابسته نباشد
          el('div.list-row__sub', {
            dataRole: 'sim-counter',
            text: `${faNumber(status.index)} از ${faNumber(status.total)} نقطه · ${faNumber(status.pingsSent)} پینگ ارسال شده`,
          }),
        ),
        el('span.chip.chip--simulated', { text: '🎬 در حال اجرا' }),
      ),
      el('div.progress-track', {},
        el('div.progress-fill', { style: { width: `${status.progress ?? 0}%` } }),
      ),
      el('div.text-xs.text-muted', {
        dataRole: 'sim-progress',
        text: `پیشرفت: ${faPercent(status.progress ?? 0)}`,
      }),
      el('button.btn.btn--danger.btn--block.mt-4', {
        type: 'button',
        text: '⏹ توقف شبیه‌سازی',
        onClick: stop,
      }),
    );
  }

  function renderIdlePanel() {
    const speedValue = el('span.font-bold', { text: `${faNumber(speed)}×` });

    const speedSlider = el('input.slider', {
      type: 'range',
      min: '1',
      max: '20',
      step: '1',
      value: String(speed),
      ariaLabel: 'ضریب سرعت پخش',
    });

    speedSlider.addEventListener('input', () => {
      speed = Number(speedSlider.value);
      speedValue.textContent = `${faNumber(speed)}×`;
    });

    return el('div', {},
      el('p.text-xs.text-muted.mb-4', {
        text: 'یک مسیر انتخاب کنید. موقعیت با سرعت پیاده‌روی روی نقشه پخش می‌شود و از همان API واقعی عبور می‌کند.',
      }),
      ...routes.map(renderRouteOption),
      el('div.field.mt-4', {},
        el('label.field__label', {}, 'سرعت پخش: ', speedValue,
          el('span.text-xs.text-muted', { text: '  (نسبت به سرعت واقعی پیاده‌روی)' }),
        ),
        speedSlider,
      ),
      el('button.btn.btn--block', {
        type: 'button',
        text: '▶ شروع شبیه‌سازی',
        onClick: start,
      }),
    );
  }

  function renderAll() {
    if (destroyed) return;

    render(
      container,
      el('div.stack', {},
        el('div.card.demo-panel', {},
          el('div.card__header', {},
            el('span', { text: '🎬', style: { fontSize: '1.3rem' }, ariaHidden: 'true' }),
            el('h2.card__title', { text: 'حالت نمایش — شبیه‌ساز موقعیت' }),
          ),
          el('div.card__body', {},
            status.running ? renderRunningPanel() : renderIdlePanel(),
          ),
        ),

        el('div.card', {},
          el('div.card__header', {}, el('h2.card__title', { text: 'این شبیه‌ساز دقیقاً چه کار می‌کند؟' })),
          el('div.card__body', {},
            el('div.stack--sm', {},
              el('div.list-row', {},
                el('div.alert-icon', { text: '✅', ariaHidden: 'true' }),
                el('div.list-row__main', {},
                  el('div.list-row__title', { text: 'واقعی است' }),
                  el('div.list-row__sub', {
                    text: 'ثبت پینگ در دیتابیس، موتور Geofence با هیسترزیس، تشخیص توقف طولانی، توزیع هشدار بر اساس سطح دسترسی، و پخش زنده با WebSocket.',
                  }),
                ),
              ),
              el('div.list-row', {},
                el('div.alert-icon', { text: '🎬', ariaHidden: 'true' }),
                el('div.list-row__main', {},
                  el('div.list-row__title', { text: 'شبیه‌سازی‌شده است' }),
                  el('div.list-row__sub', {
                    text: 'فقط منبع مختصات. هر پینگ با پرچم is_simulated در دیتابیس ذخیره می‌شود و در تمام صفحات با برچسب «حالت نمایش» دیده می‌شود.',
                  }),
                ),
              ),
              el('div.list-row', {},
                el('div.alert-icon', { text: '📐', ariaHidden: 'true' }),
                el('div.list-row__main', {},
                  el('div.list-row__title', { text: 'مسیرها نسبی‌اند، نه ثابت' }),
                  el('div.list-row__sub', {
                    text: 'هر مسیر نسبت به مرکز اولین محدوده‌ی امن شما ساخته می‌شود، پس رابطه‌ی هندسی‌اش با محدوده همیشه درست است.',
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  async function load() {
    render(container, ...skeleton('card', 2));

    try {
      const [routeResult, statusResult] = await Promise.all([
        api.simulatorRoutes(),
        api.simulatorStatus(),
      ]);

      routes = routeResult.routes ?? [];
      status = statusResult ?? { running: false };

      if (status.running && status.routeId) selectedRoute = status.routeId;

      renderAll();
    } catch (error) {
      render(container, errorState({ text: error.message, onRetry: load }));
    }
  }

  // وضعیت شبیه‌ساز از سرور می‌آید، نه از تایمر محلی —
  // اگر چند تب باز باشد، همه یک وضعیت واحد می‌بینند
  unsubscribers.push(
    realtime.on(WS_EVENTS.SIMULATOR_STATUS, (payload) => {
      status = payload ?? { running: false };

      // به‌جای بازسازی کل صفحه، فقط نوار پیشرفت به‌روز می‌شود تا نپرد
      const fill = container.querySelector('.progress-fill');
      if (status.running && fill) {
        fill.style.width = `${status.progress ?? 0}%`;

        const counter = container.querySelector('[data-role="sim-counter"]');
        if (counter) {
          counter.textContent =
            `${faNumber(status.index)} از ${faNumber(status.total)} نقطه · ${faNumber(status.pingsSent)} پینگ ارسال شده`;
        }

        const progressText = container.querySelector('[data-role="sim-progress"]');
        if (progressText) {
          progressText.textContent = `پیشرفت: ${faPercent(status.progress ?? 0)}`;
        }
        return;
      }

      renderAll();
    }),
  );

  load();

  return () => {
    destroyed = true;
    unsubscribers.forEach((fn) => fn());
  };
}

export default mountDemo;
