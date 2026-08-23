/**
 * پوسته‌ی اپلیکیشن: احراز هویت، ناوبری، اتصال زنده و مسیریابی بین نماها.
 *
 * تب‌های نمایش‌داده‌شده به رابطه‌های واقعی کاربر بستگی دارد، نه به ستون
 * role در دیتابیس: کسی که هم کاربر اصلی است و هم مراقب مادرش، هر دو
 * دسته تب را می‌بیند. نقش در این محصول یک برچسب ثابت نیست، یک رابطه است.
 */
import api, { loadSession, getAccessToken, clearSession, patchStoredSettings } from './api.js';
import realtime, { WS_EVENTS, CONNECTION_LABELS } from './realtime.js';
import { el, render, toast, $, applyTheme, getTheme, cycleTheme, THEME_ICONS, THEME_LABELS } from './ui.js';
import { faNumber, initials } from './format.js';

import { mountAuth } from './views/auth.js';
import { mountDashboard } from './views/dashboard.js';
import { mountGuardian } from './views/guardian.js';
import { mountAlerts } from './views/alerts.js';
import { mountFamily } from './views/family.js';
import { mountZones } from './views/zones.js';
import { mountHistory } from './views/history.js';
import { mountSettings } from './views/settings.js';
import { mountDemo } from './views/demo.js';

const root = $('#root');

/** وضعیت سراسری اپ. */
const state = {
  user: null,
  settings: null,
  links: { guardians: [], primaries: [] },
  unreadCount: 0,
  currentView: null,
  currentParams: {},
  cleanup: null,
};

/* ─────────────────────── تعریف تب‌ها ─────────────────────── */

const VIEWS = {
  dashboard: { label: 'داشبورد', icon: '🏠', mount: mountDashboard, forPrimary: true },
  guardian: { label: 'تحت مراقبت', icon: '👀', mount: mountGuardian, forGuardian: true },
  alerts: { label: 'هشدارها', icon: '🔔', mount: mountAlerts, always: true, badge: true },
  zones: { label: 'محدوده‌های امن', icon: '📍', mount: mountZones, forPrimary: true },
  family: { label: 'اعضای خانواده', icon: '👨‍👩‍👧', mount: mountFamily, always: true },
  history: { label: 'تاریخچه‌ی مسیر', icon: '🗺️', mount: mountHistory, always: true },
  demo: { label: 'حالت نمایش', icon: '🎬', mount: mountDemo, forPrimary: true },
  settings: { label: 'تنظیمات', icon: '⚙️', mount: mountSettings, always: true },
};

/**
 * تعیین تب‌های قابل نمایش.
 * «کاربر اصلی بودن» یعنی نقش primary دارد یا محدوده‌ی امن ساخته است.
 * «عضو خانواده بودن» یعنی حداقل یک رابطه‌ی فعال با کاربر دیگری دارد.
 */
function visibleViews() {
  const isPrimary = state.user?.role === 'primary';
  const isGuardian = state.links.primaries.length > 0;

  return Object.entries(VIEWS).filter(([, view]) => {
    if (view.always) return true;
    if (view.forPrimary && isPrimary) return true;
    if (view.forGuardian && isGuardian) return true;
    return false;
  });
}

/** نمای پیش‌فرض بر اساس نقش. */
function defaultView() {
  if (state.user?.role === 'guardian' || state.links.primaries.length > 0) {
    return state.user?.role === 'primary' ? 'dashboard' : 'guardian';
  }
  return 'dashboard';
}

/* ─────────────────────── سربرگ ─────────────────────── */

let connectionChip = null;
let tabsContainer = null;

function renderHeader() {
  const theme = getTheme();

  connectionChip = el('span.chip', { text: '◐ در حال اتصال…' });
  tabsContainer = el('div.nav-tabs', { role: 'tablist', ariaLabel: 'ناوبری اصلی' });

  const header = el(
    'header.app-header',
    {},
    el(
      'div.brand',
      {},
      el('span.brand__mark', { text: '🚶', ariaHidden: 'true' }),
      el(
        'span',
        {},
        el('div', { text: 'هم‌قدم' }),
        el('div.brand__sub', { text: 'ایمنی، بدون از دست دادن استقلال' }),
      ),
    ),
    el('div.header-spacer'),
    connectionChip,
    el('button.icon-btn', {
      type: 'button',
      text: THEME_ICONS[theme],
      title: THEME_LABELS[theme],
      ariaLabel: `تغییر تم — فعلاً ${THEME_LABELS[theme]}`,
      onClick: (event) => {
        const next = cycleTheme();
        event.currentTarget.textContent = THEME_ICONS[next];
        event.currentTarget.title = THEME_LABELS[next];
        event.currentTarget.setAttribute('aria-label', `تغییر تم — فعلاً ${THEME_LABELS[next]}`);
      },
    }),
    el('span.avatar', {
      text: initials(state.user.fullName),
      title: state.user.fullName,
      style: { background: state.user.avatarColor ?? 'var(--accent)' },
    }),
  );

  return { header, tabsContainer };
}

function renderTabs() {
  if (!tabsContainer) return;

  render(
    tabsContainer,
    ...visibleViews().map(([key, view]) =>
      el(
        'button.nav-tab',
        {
          type: 'button',
          role: 'tab',
          ariaSelected: String(key === state.currentView),
          onClick: () => navigate(key),
        },
        el('span', { text: view.icon, ariaHidden: 'true' }),
        el('span', { text: view.label }),
        view.badge && state.unreadCount > 0
          ? el('span.nav-tab__badge', { text: faNumber(state.unreadCount) })
          : null,
      ),
    ),
  );
}

/* ─────────────────────── مسیریابی ─────────────────────── */

let viewContainer = null;

function navigate(viewKey, params = {}) {
  const view = VIEWS[viewKey];
  if (!view) return;

  // پاک‌سازی نمای قبلی — بدون این، شنونده‌های WebSocket و نقشه‌ها نشت می‌کنند
  state.cleanup?.();
  state.cleanup = null;

  state.currentView = viewKey;
  state.currentParams = params;

  renderTabs();
  window.location.hash = viewKey;

  viewContainer.replaceChildren();
  state.cleanup = view.mount(viewContainer, buildContext(), params);

  // پس از تعویض نما، تمرکز به ابتدای محتوا می‌رود تا کاربر صفحه‌خوان گم نشود
  viewContainer.focus?.();
}

/** بافتی که به همه‌ی نماها داده می‌شود. */
function buildContext() {
  return {
    user: state.user,
    settings: state.settings,
    links: state.links,
    navigate,
    logout: doLogout,
    setUnreadCount(count) {
      state.unreadCount = count;
      renderTabs();
    },
    updateSettings(settings) {
      state.settings = settings;
      patchStoredSettings(settings);
    },
    async refreshRole() {
      await loadLinks();
      renderTabs();
    },
  };
}

/* ─────────────────────── داده‌ی پایه ─────────────────────── */

async function loadLinks() {
  try {
    const links = await api.guardianships();
    state.links = { guardians: links.guardians ?? [], primaries: links.primaries ?? [] };
  } catch {
    state.links = { guardians: [], primaries: [] };
  }
}

async function loadUnreadCount() {
  try {
    const result = await api.alerts({ limit: 1 });
    state.unreadCount = result.unreadCount ?? 0;
  } catch {
    state.unreadCount = 0;
  }
}

/* ─────────────────────── اتصال زنده ─────────────────────── */

function updateConnectionChip(connectionState) {
  if (!connectionChip) return;

  const meta = CONNECTION_LABELS[connectionState] ?? CONNECTION_LABELS.disconnected;
  connectionChip.className = `chip ${meta.className}`;
  connectionChip.textContent = `${meta.dot} ${meta.text}`;
}

function setupRealtime() {
  realtime.on('connection', updateConnectionChip);

  /**
   * نوتیفیکیشن درون‌برنامه‌ای.
   * این همان مسیری است که وقتی کلید FCM تنظیم نشده باشد، تحویل را انجام
   * می‌دهد — و همان مسیری که تأخیر زیر دو ثانیه‌ی دمو را تضمین می‌کند.
   */
  realtime.on(WS_EVENTS.NOTIFICATION, (payload) => {
    toast(payload.title, payload.body, { severity: payload.severity });
  });

  realtime.on(WS_EVENTS.ALERT_NEW, (alert) => {
    if (alert.isResolution) return;
    // شمارنده‌ی نخوانده‌ها فقط برای هشدارهای مربوط به دیگران بالا می‌رود
    state.unreadCount += 1;
    renderTabs();
  });

  realtime.on(WS_EVENTS.SHARING_CHANGED, (payload) => {
    if (payload.userId === state.user?.id) return;
    toast(
      payload.sharingEnabled ? 'اشتراک موقعیت روشن شد' : 'موقعیت مخفی شد',
      payload.sharingEnabled
        ? 'موقعیت دوباره در دسترس است.'
        : 'کاربر اشتراک‌گذاری موقعیت را خاموش کرد.',
    );
  });

  realtime.connect(getAccessToken());
}

/* ─────────────────────── ورود و خروج ─────────────────────── */

async function doLogout() {
  state.cleanup?.();
  realtime.disconnect();

  try {
    await api.logout();
  } catch {
    clearSession();
  }

  state.user = null;
  showAuth();
}

function showAuth() {
  render(root, el('div'));
  mountAuth(root, {
    onSuccess: (session) => {
      state.user = session.user;
      state.settings = session.settings;
      startApp();
    },
  });
}

/* ─────────────────────── راه‌اندازی ─────────────────────── */

async function startApp() {
  await Promise.all([loadLinks(), loadUnreadCount()]);

  const { header } = renderHeader();

  viewContainer = el('div', { id: 'view', tabindex: '-1' });

  render(
    root,
    el(
      'div.app-shell',
      {},
      el('a.skip-link', { href: '#view', text: 'پرش به محتوای اصلی' }),
      header,
      el(
        'main#main.app-main',
        {},
        el('div.mb-4', {}, tabsContainer),
        viewContainer,
      ),
    ),
  );

  setupRealtime();

  // ثبت این مرورگر به‌عنوان یک دستگاه، تا ساختار FCM از همین‌جا هم تغذیه شود
  api
    .registerDevice({ platform: 'web', deviceName: 'مرورگر وب' })
    .catch(() => {});

  const fromHash = window.location.hash.replace('#', '');
  const initial = VIEWS[fromHash] ? fromHash : defaultView();

  renderTabs();
  navigate(initial);
}

/* ─────────────────────── نقطه‌ی شروع ─────────────────────── */

function boot() {
  applyTheme(getTheme());

  const session = loadSession();

  if (session?.accessToken) {
    state.user = session.user;
    state.settings = session.settings;

    // اعتبار نشست را می‌سنجیم؛ اگر باطل بود به صفحه‌ی ورود می‌رویم
    api
      .me()
      .then((result) => {
        state.user = result.user;
        state.settings = result.settings;
        startApp();
      })
      .catch(() => {
        clearSession();
        showAuth();
      });
  } else {
    showAuth();
  }
}

// نشست منقضی‌شده در میانه‌ی کار
window.addEventListener('safestep:session-expired', () => {
  toast('نشست منقضی شد', 'لطفاً دوباره وارد شوید.', { severity: 'warning' });
  state.cleanup?.();
  realtime.disconnect();
  showAuth();
});

// ناوبری با دکمه‌ی back مرورگر
window.addEventListener('hashchange', () => {
  const key = window.location.hash.replace('#', '');
  if (VIEWS[key] && key !== state.currentView && state.user) navigate(key);
});

boot();
