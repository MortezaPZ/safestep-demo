/**
 * صفحه‌ی ورود و ثبت‌نام.
 *
 * دکمه‌های «حساب‌های آماده‌ی دمو» عمداً اینجاست: در یک جلسه‌ی سه دقیقه‌ای،
 * تایپ کردن شماره و رمز در دو پنجره وقت تلف کردن است. این دکمه‌ها فیلد را
 * پر می‌کنند، نه اینکه احراز هویت را دور بزنند — ورود همچنان واقعی است.
 */
import api from '../api.js';
import { el, render, toast } from '../ui.js';
import { toEnDigits } from '../format.js';

const DEMO_ACCOUNTS = [
  { phone: '09121110001', name: 'مریم رضایی', role: 'کاربر اصلی', icon: '👤' },
  { phone: '09121110002', name: 'علی رضایی', role: 'عضو خانواده — دسترسی کامل', icon: '👨' },
  { phone: '09121110003', name: 'زهرا رضایی', role: 'عضو خانواده — بدون دسترسی اضطراری', icon: '👩' },
];

const DEMO_PASSWORD = 'Test@1234';

export function mountAuth(container, { onSuccess }) {
  let mode = 'login';

  const errorBox = el('div.field__error', { role: 'alert' });
  const phoneInput = el('input.input', {
    type: 'tel',
    id: 'auth-phone',
    inputmode: 'numeric',
    placeholder: '۰۹۱۲۳۴۵۶۷۸۹',
    autocomplete: 'tel',
    dir: 'ltr',
  });
  const passwordInput = el('input.input', {
    type: 'password',
    id: 'auth-password',
    placeholder: '••••••••',
    autocomplete: 'current-password',
  });
  const nameInput = el('input.input', {
    type: 'text',
    id: 'auth-name',
    placeholder: 'نام و نام خانوادگی',
    autocomplete: 'name',
  });
  const roleSelect = el(
    'select.select',
    { id: 'auth-role' },
    el('option', { value: 'primary', text: 'کاربر اصلی — من می‌خواهم مستقل بیرون بروم' }),
    el('option', { value: 'guardian', text: 'عضو خانواده — می‌خواهم مراقب کسی باشم' }),
  );

  const nameField = el(
    'div.field',
    {},
    el('label.field__label', { for: 'auth-name', text: 'نام کامل' }),
    nameInput,
  );

  const roleField = el(
    'div.field',
    {},
    el('label.field__label', { for: 'auth-role', text: 'نقش شما' }),
    roleSelect,
  );

  const submitBtn = el('button.btn.btn--block', { type: 'submit', text: 'ورود' });

  const loginTab = el('button.auth-tab', {
    type: 'button',
    role: 'tab',
    ariaSelected: 'true',
    text: 'ورود',
    onClick: () => setMode('login'),
  });

  const registerTab = el('button.auth-tab', {
    type: 'button',
    role: 'tab',
    ariaSelected: 'false',
    text: 'ثبت‌نام',
    onClick: () => setMode('register'),
  });

  function setMode(next) {
    mode = next;
    const isLogin = next === 'login';

    loginTab.setAttribute('aria-selected', String(isLogin));
    registerTab.setAttribute('aria-selected', String(!isLogin));
    nameField.classList.toggle('hidden', isLogin);
    roleField.classList.toggle('hidden', isLogin);
    submitBtn.textContent = isLogin ? 'ورود' : 'ساخت حساب';
    passwordInput.setAttribute('autocomplete', isLogin ? 'current-password' : 'new-password');
    errorBox.textContent = '';
  }

  async function submit(event) {
    event.preventDefault();
    errorBox.textContent = '';

    const phone = toEnDigits(phoneInput.value).replace(/\D/g, '');
    const password = passwordInput.value;

    if (!phone || !password) {
      errorBox.textContent = 'شماره موبایل و رمز عبور را وارد کنید.';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = mode === 'login' ? 'در حال ورود…' : 'در حال ساخت حساب…';

    try {
      const session =
        mode === 'login'
          ? await api.login(phone, password)
          : await api.register({
              phone,
              password,
              fullName: nameInput.value.trim(),
              role: roleSelect.value,
            });

      toast('خوش آمدید', session.user.fullName);
      onSuccess(session);
    } catch (error) {
      // خطاهای اعتبارسنجی فیلد‌به‌فیلد را هم نشان می‌دهیم
      const details = error.details?.map((d) => d.message).join(' · ');
      errorBox.textContent = details || error.message || 'ورود ناموفق بود.';
      submitBtn.disabled = false;
      submitBtn.textContent = mode === 'login' ? 'ورود' : 'ساخت حساب';
    }
  }

  const form = el(
    'form',
    { onSubmit: submit, novalidate: 'novalidate' },
    nameField,
    el(
      'div.field',
      {},
      el('label.field__label', { for: 'auth-phone', text: 'شماره موبایل' }),
      phoneInput,
    ),
    el(
      'div.field',
      {},
      el('label.field__label', { for: 'auth-password', text: 'رمز عبور' }),
      passwordInput,
    ),
    roleField,
    errorBox,
    submitBtn,
  );

  const demoBlock = el(
    'div.demo-accounts',
    {},
    el('p.text-xs.text-muted.mb-4', {
      text: 'حساب‌های آماده‌ی دمو — با یک کلیک فیلدها پر می‌شوند:',
    }),
    ...DEMO_ACCOUNTS.map((account) =>
      el(
        'button.demo-account',
        {
          type: 'button',
          onClick: () => {
            setMode('login');
            phoneInput.value = account.phone;
            passwordInput.value = DEMO_PASSWORD;
            passwordInput.focus();
          },
        },
        el('span', { text: account.icon, style: { fontSize: '1.3rem' } }),
        el(
          'span',
          { style: { flex: '1' } },
          el('div.list-row__title', { text: account.name }),
          el('div.list-row__sub', { text: account.role }),
        ),
      ),
    ),
  );

  const card = el(
    'div.auth-card',
    {},
    el(
      'div.brand.mb-4',
      {},
      el('span.brand__mark', { text: '🚶', ariaHidden: 'true' }),
      el(
        'span',
        {},
        el('div', { text: 'هم‌قدم' }),
        el('div.brand__sub', { text: 'ایمنی، بدون از دست دادن استقلال' }),
      ),
    ),
    el('div.auth-tabs', { role: 'tablist' }, loginTab, registerTab),
    form,
    demoBlock,
  );

  setMode('login');
  render(container, el('div.auth-screen', {}, card));

  phoneInput.focus();

  return () => {};
}

export default mountAuth;
