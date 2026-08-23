/**
 * ابزارهای کوچک رابط کاربری: ساخت المان، اعلان شناور، دیالوگ و حالت‌های صفحه.
 *
 * عمداً هیچ فریمورکی استفاده نشده است. این داشبورد چند صفحه دارد و
 * افزودن یک لایه‌ی بیلد فقط برای این حجم، هزینه‌ی راه‌اندازی دمو را
 * بالا می‌برد بدون اینکه چیزی به کیفیت اضافه کند.
 */

/**
 * ساخت المان با ویژگی‌ها و فرزندان.
 * @param {string} tag نام تگ، با کلاس‌های اختیاری: 'div.card.card--big'
 */
export function el(tag, props = {}, ...children) {
  const [tagName, ...classes] = tag.split('.');
  const node = document.createElement(tagName);

  if (classes.length > 0) node.className = classes.join(' ');

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') {
      node.className = node.className ? `${node.className} ${value}` : value;
    } else if (key === 'html') {
      node.innerHTML = value;
    } else if (key === 'text') {
      node.textContent = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key.startsWith('data') || key.startsWith('aria') || key === 'role') {
      // تبدیل dataUnread → data-unread و ariaLabel → aria-label
      const attr = key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
      node.setAttribute(attr, value);
    } else {
      node.setAttribute(key, value);
    }
  }

  for (const child of children.flat(3)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return node;
}

/** پاک کردن و پر کردن دوباره‌ی یک ظرف. */
export function render(container, ...children) {
  container.replaceChildren(...children.flat(3).filter(Boolean));
  return container;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/* ─────────────────────────── اعلان شناور ─────────────────────────── */

let toastStack = null;

function ensureToastStack() {
  if (!toastStack) {
    toastStack = el('div.toast-stack', { role: 'status', ariaLive: 'polite' });
    document.body.append(toastStack);
  }
  return toastStack;
}

/**
 * نمایش اعلان شناور.
 * @param {string} title
 * @param {string} [text]
 * @param {{severity?: 'info'|'warning'|'critical', duration?: number}} [options]
 */
export function toast(title, text, { severity = 'info', duration = 4500 } = {}) {
  const stack = ensureToastStack();

  const node = el(
    'div.toast',
    { dataSeverity: severity },
    el('div', { style: { flex: '1' } },
      el('div.toast__title', { text: title }),
      text ? el('div.toast__text', { text }) : null,
    ),
  );

  stack.append(node);

  // هشدار بحرانی طولانی‌تر می‌ماند — نباید پیش از دیده شدن ناپدید شود
  const ttl = severity === 'critical' ? Math.max(duration, 9000) : duration;

  setTimeout(() => {
    node.style.transition = 'opacity 200ms, transform 200ms';
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 220);
  }, ttl);

  return node;
}

/* ─────────────────────────── دیالوگ ─────────────────────────── */

/**
 * نمایش دیالوگ. تمرکز به داخل دیالوگ منتقل می‌شود و با Escape بسته می‌شود.
 * @returns {{close: Function, node: HTMLElement}}
 */
export function dialog({ title, content, actions = [], onClose, dismissible = true }) {
  const previousFocus = document.activeElement;

  const body = el('div', {}, content);
  const actionRow = el('div.dialog__actions');

  const panel = el(
    'div.dialog',
    { role: 'dialog', ariaModal: 'true', ariaLabel: title },
    title ? el('h2.dialog__title', { text: title }) : null,
    body,
    actions.length > 0 ? actionRow : null,
  );

  const backdrop = el('div.dialog-backdrop', {}, panel);

  function close() {
    document.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
    previousFocus?.focus?.();
    onClose?.();
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && dismissible) close();
  }

  for (const action of actions) {
    actionRow.append(
      el('button', {
        class: `btn ${action.variant ? `btn--${action.variant}` : ''}`,
        type: 'button',
        onClick: () => action.onClick?.(close),
        text: action.label,
      }),
    );
  }

  if (dismissible) {
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });
  }

  document.addEventListener('keydown', onKeyDown);
  document.body.append(backdrop);

  // تمرکز روی اولین عنصر تعاملی داخل دیالوگ
  const focusable = panel.querySelector('button, input, select, textarea, [tabindex]');
  focusable?.focus();

  return { close, node: panel };
}

/** دیالوگ تأیید ساده. */
export function confirmDialog({ title, message, confirmLabel = 'تأیید', variant = 'danger' }) {
  return new Promise((resolve) => {
    dialog({
      title,
      content: el('p.dialog__text', { text: message }),
      onClose: () => resolve(false),
      actions: [
        { label: 'انصراف', variant: 'secondary', onClick: (close) => { resolve(false); close(); } },
        { label: confirmLabel, variant, onClick: (close) => { resolve(true); close(); } },
      ],
    });
  });
}

/* ─────────────────────────── حالت‌های صفحه ─────────────────────────── */

/** اسکلتون بارگذاری — به‌جای اسپینر، شکلِ محتوای در راه را نشان می‌دهد. */
export function skeleton(variant = 'text', count = 1) {
  return Array.from({ length: count }, () => el(`div.skeleton.skeleton--${variant}`));
}

export function emptyState({ icon = '📭', title, text, action }) {
  return el(
    'div.state-block',
    {},
    el('div.state-block__icon', { text: icon }),
    el('h3.state-block__title', { text: title }),
    text ? el('p.state-block__text', { text }) : null,
    action
      ? el('button.btn', { type: 'button', onClick: action.onClick, text: action.label })
      : null,
  );
}

export function errorState({ title = 'مشکلی پیش آمد', text, onRetry }) {
  return el(
    'div.state-block.state-block--error',
    {},
    el('div.state-block__icon', { text: '⚠️' }),
    el('h3.state-block__title', { text: title }),
    text ? el('p.state-block__text', { text }) : null,
    onRetry
      ? el('button.btn.btn--secondary', { type: 'button', onClick: onRetry, text: 'تلاش دوباره' })
      : null,
  );
}

/* ─────────────────────────── بازخورد لمسی ─────────────────────────── */

/**
 * لرزش دستگاه. روی دسکتاپ بی‌اثر است و خطا هم نمی‌دهد.
 * برای SOS استفاده می‌شود: تأیید فیزیکی که دکمه واقعاً فشرده شده،
 * برای کسی که ممکن است به صفحه نگاه نکند یا نتواند نگاه کند.
 */
export function haptic(pattern = 40) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* دستگاه پشتیبانی نمی‌کند */
  }
}

/* ─────────────────────────── تم ─────────────────────────── */

const THEME_KEY = 'safestep.theme';

export function getTheme() {
  return localStorage.getItem(THEME_KEY) ?? 'system';
}

export function applyTheme(theme) {
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  localStorage.setItem(THEME_KEY, theme);
}

export function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(getTheme()) + 1) % order.length];
  applyTheme(next);
  return next;
}

export const THEME_ICONS = { system: '🖥️', light: '☀️', dark: '🌙' };
export const THEME_LABELS = { system: 'تم سیستم', light: 'تم روشن', dark: 'تم تیره' };
