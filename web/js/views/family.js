/**
 * صفحه‌ی اعضای خانواده.
 *
 * دو جهت رابطه در یک صفحه:
 *   • «اعضایی که به من دسترسی دارند» — با امکان تغییر سطح و قطع دسترسی
 *   • «کسانی که من مراقبشان هستم» — با امکان کنار گذاشتن مسئولیت
 *
 * کد دعوت فقط یک بار نمایش داده می‌شود چون در سرور فقط هش آن ذخیره شده
 * و بازیابی‌اش ممکن نیست. این محدودیت در رابط کاربری صریح گفته می‌شود
 * تا کاربر فکر نکند چیزی گم شده است.
 */
import api from '../api.js';
import realtime, { WS_EVENTS } from '../realtime.js';
import { el, render, toast, dialog, confirmDialog, skeleton, emptyState, errorState } from '../ui.js';
import { faRelativeTime, faNumber, toEnDigits, PERMISSION_LABELS, initials } from '../format.js';

const PERMISSION_HINTS = {
  view_location: 'موقعیت زنده و تاریخچه‌ی مسیر شما را می‌بیند.',
  receive_alerts: 'هشدار خروج از محدوده، توقف طولانی و قطع GPS را دریافت می‌کند.',
  emergency: 'هشدار اضطراری (SOS) را دریافت می‌کند و می‌تواند تماس بگیرد.',
};

export function mountFamily(container, ctx) {
  let guardians = [];
  let primaries = [];
  let invites = [];
  let destroyed = false;
  const unsubscribers = [];

  /* ─────────────────────── ساخت کد دعوت ─────────────────────── */

  function openInviteDialog() {
    const selected = new Set(['view_location', 'receive_alerts']);

    const checkboxes = Object.entries(PERMISSION_LABELS).map(([key, label]) =>
      el('label.list-row', { style: { cursor: 'pointer' } },
        el('input', {
          type: 'checkbox',
          checked: selected.has(key) ? 'checked' : null,
          style: { width: '22px', height: '22px' },
          onChange: (event) => {
            if (event.target.checked) selected.add(key);
            else selected.delete(key);
          },
        }),
        el('div.list-row__main', {},
          el('div.list-row__title', { text: label }),
          el('div.list-row__sub', { text: PERMISSION_HINTS[key] }),
        ),
      ),
    );

    dialog({
      title: 'ساخت کد دعوت',
      content: el('div', {},
        el('p.dialog__text.mb-4', {
          text: 'انتخاب کنید این عضو خانواده به چه چیزهایی دسترسی داشته باشد. بعداً هم می‌توانید تغییرش دهید.',
        }),
        el('div.stack--sm', {}, ...checkboxes),
      ),
      actions: [
        { label: 'انصراف', variant: 'secondary', onClick: (close) => close() },
        {
          label: 'ساخت کد',
          onClick: async (close) => {
            if (selected.size === 0) {
              toast('انتخاب لازم است', 'حداقل یک سطح دسترسی انتخاب کنید.', { severity: 'warning' });
              return;
            }
            close();
            await createInvite([...selected]);
          },
        },
      ],
    });
  }

  async function createInvite(permissions) {
    try {
      const result = await api.createInvite(permissions);
      showCode(result);
      await load({ silent: true });
    } catch (error) {
      toast('ساخت کد ناموفق بود', error.message, { severity: 'warning' });
    }
  }

  function showCode(result) {
    const digits = String(result.code).split('');

    dialog({
      title: 'کد دعوت آماده است',
      content: el('div', {},
        el('div.code-display', {},
          ...digits.map((digit) => el('div.code-digit', { text: digit })),
        ),
        el('p.dialog__text', {
          text: `این کد تا ${faNumber(result.expiresInMinutes)} دقیقه‌ی دیگر معتبر است و فقط یک بار قابل استفاده است.`,
        }),
        el('div.chip-row', {},
          ...result.permissionLabels.map((label) => el('span.chip.chip--accent', { text: label })),
        ),
        el('p.text-xs.text-muted.mt-4', {
          text: 'این کد دوباره نمایش داده نمی‌شود — در سرور فقط اثر رمزنگاری‌شده‌اش ذخیره شده است.',
        }),
      ),
      actions: [
        {
          label: 'کپی کد',
          variant: 'secondary',
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(result.code);
              toast('کپی شد', 'کد دعوت در حافظه کپی شد.');
            } catch {
              toast('کپی نشد', 'کد را دستی یادداشت کنید.', { severity: 'warning' });
            }
          },
        },
        { label: 'بستن', onClick: (close) => close() },
      ],
    });
  }

  /* ─────────────────────── مصرف کد دعوت ─────────────────────── */

  function openRedeemDialog() {
    const input = el('input.input.input--code', {
      type: 'text',
      inputmode: 'numeric',
      maxlength: '6',
      placeholder: '------',
      ariaLabel: 'کد دعوت ۶ رقمی',
    });

    const errorBox = el('div.field__error', { role: 'alert' });

    input.addEventListener('input', () => {
      input.value = toEnDigits(input.value).replace(/\D/g, '').slice(0, 6);
      errorBox.textContent = '';
    });

    const { close } = dialog({
      title: 'وارد کردن کد دعوت',
      content: el('div', {},
        el('p.dialog__text', {
          text: 'کد ۶ رقمی‌ای که فرد مورد نظر ساخته را وارد کنید.',
        }),
        input,
        errorBox,
      ),
      actions: [
        { label: 'انصراف', variant: 'secondary', onClick: (closeDialog) => closeDialog() },
        {
          label: 'اتصال',
          onClick: async () => {
            const code = input.value.trim();
            if (code.length !== 6) {
              errorBox.textContent = 'کد باید ۶ رقم باشد.';
              return;
            }

            try {
              const result = await api.redeemInvite(code);
              close();
              toast(
                'اتصال برقرار شد',
                `حالا می‌توانید ${result.guardianship.primaryUser.fullName} را دنبال کنید.`,
              );
              await load();
              ctx.refreshRole?.();
            } catch (error) {
              errorBox.textContent = error.message;
            }
          },
        },
      ],
    });

    input.focus();
  }

  /* ─────────────────────── تغییر سطح دسترسی ─────────────────────── */

  function openPermissionsDialog(link) {
    const selected = new Set(link.permissions);

    const checkboxes = Object.entries(PERMISSION_LABELS).map(([key, label]) =>
      el('label.list-row', { style: { cursor: 'pointer' } },
        el('input', {
          type: 'checkbox',
          checked: selected.has(key) ? 'checked' : null,
          style: { width: '22px', height: '22px' },
          onChange: (event) => {
            if (event.target.checked) selected.add(key);
            else selected.delete(key);
          },
        }),
        el('div.list-row__main', {},
          el('div.list-row__title', { text: label }),
          el('div.list-row__sub', { text: PERMISSION_HINTS[key] }),
        ),
      ),
    );

    dialog({
      title: `سطح دسترسی ${link.guardianUser?.fullName ?? ''}`,
      content: el('div.stack--sm', {}, ...checkboxes),
      actions: [
        { label: 'انصراف', variant: 'secondary', onClick: (close) => close() },
        {
          label: 'ذخیره',
          onClick: async (close) => {
            if (selected.size === 0) {
              toast('انتخاب لازم است', 'حداقل یک سطح دسترسی لازم است.', { severity: 'warning' });
              return;
            }
            try {
              await api.updatePermissions(link.id, [...selected]);
              close();
              toast('ذخیره شد', 'سطح دسترسی به‌روزرسانی شد.');
              await load();
            } catch (error) {
              toast('ذخیره ناموفق بود', error.message, { severity: 'warning' });
            }
          },
        },
      ],
    });
  }

  async function revoke(link, name) {
    const confirmed = await confirmDialog({
      title: 'قطع دسترسی؟',
      message: `${name} دیگر موقعیت و هشدارهای شما را نخواهد دید. این کار قابل بازگشت است — می‌توانید دوباره کد دعوت بسازید.`,
      confirmLabel: 'قطع کن',
    });

    if (!confirmed) return;

    try {
      await api.revokeGuardianship(link.id);
      toast('دسترسی قطع شد');
      await load();
      ctx.refreshRole?.();
    } catch (error) {
      toast('عملیات ناموفق بود', error.message, { severity: 'warning' });
    }
  }

  /* ─────────────────────── چیدمان ─────────────────────── */

  function renderGuardianRow(link) {
    const person = link.guardianUser ?? {};

    return el('div.list-row', {},
      el('span.avatar.avatar--lg', {
        text: initials(person.fullName),
        style: { background: person.avatarColor ?? 'var(--accent)' },
      }),
      el('div.list-row__main', {},
        el('div.list-row__title', {},
          person.fullName ?? '—',
          link.nickname ? ` (${link.nickname})` : '',
        ),
        el('div.list-row__sub', { text: person.phone ?? '' }),
        el('div.chip-row', {},
          el('span', {
            class: `chip ${link.isOnline ? 'chip--safe' : ''}`,
            text: link.isOnline ? '● آنلاین' : '○ آفلاین',
          }),
          ...link.permissions.map((p) =>
            el('span', {
              class: `chip ${p === 'emergency' ? 'chip--danger' : 'chip--accent'}`,
              text: PERMISSION_LABELS[p],
            }),
          ),
        ),
      ),
      el('div.list-row__actions', {},
        el('button.btn.btn--secondary.btn--sm', {
          type: 'button',
          text: 'سطح دسترسی',
          onClick: () => openPermissionsDialog(link),
        }),
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'قطع دسترسی',
          onClick: () => revoke(link, person.fullName ?? 'این شخص'),
        }),
      ),
    );
  }

  function renderPrimaryRow(link) {
    const person = link.primaryUser ?? {};

    return el('div.list-row', {},
      el('span.avatar.avatar--lg', {
        text: initials(person.fullName),
        style: { background: person.avatarColor ?? 'var(--accent)' },
      }),
      el('div.list-row__main', {},
        el('div.list-row__title', { text: person.fullName ?? '—' }),
        el('div.list-row__sub', { text: person.phone ?? '' }),
        el('div.chip-row', {},
          el('span', {
            class: `chip ${link.isOnline ? 'chip--safe' : ''}`,
            text: link.isOnline ? '● آنلاین' : '○ آفلاین',
          }),
          ...link.permissions.map((p) =>
            el('span.chip.chip--accent', { text: PERMISSION_LABELS[p] }),
          ),
        ),
      ),
      el('div.list-row__actions', {},
        el('button.btn.btn--secondary.btn--sm', {
          type: 'button',
          text: 'مشاهده',
          onClick: () => ctx.navigate('guardian'),
        }),
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'کنار گذاشتن',
          onClick: () => revoke(link, person.fullName ?? 'این شخص'),
        }),
      ),
    );
  }

  function renderActiveInvites() {
    const active = invites.filter((i) => !i.isUsed && !i.isExpired);
    if (active.length === 0) return null;

    return el('div.card', {},
      el('div.card__header', {}, el('h2.card__title', { text: 'کدهای دعوت فعال' })),
      el('div.card__body', {},
        ...active.map((invite) =>
          el('div.list-row', {},
            el('div.alert-icon', { text: '🎟️', ariaHidden: 'true' }),
            el('div.list-row__main', {},
              el('div.list-row__title', { text: 'کد دعوت (نمایش‌داده‌شده فقط یک بار)' }),
              el('div.list-row__sub', {
                text: `اعتبار تا ${faRelativeTime(invite.expiresAt)}`,
              }),
              el('div.chip-row', {},
                ...invite.permissions.map((p) =>
                  el('span.chip.chip--accent', { text: PERMISSION_LABELS[p] }),
                ),
              ),
            ),
            el('button.btn.btn--ghost.btn--sm', {
              type: 'button',
              text: 'لغو',
              onClick: async () => {
                try {
                  await api.cancelInvite(invite.id);
                  toast('کد لغو شد');
                  await load();
                } catch (error) {
                  toast('عملیات ناموفق بود', error.message, { severity: 'warning' });
                }
              },
            }),
          ),
        ),
      ),
    );
  }

  function renderAll() {
    if (destroyed) return;

    render(
      container,
      el('div.stack', {},
        el('div.card', {},
          el('div.card__header', {},
            el('h2.card__title', { text: 'اعضایی که به من دسترسی دارند' }),
            el('div.header-spacer'),
            el('button.btn.btn--sm', {
              type: 'button',
              text: '＋ ساخت کد دعوت',
              onClick: openInviteDialog,
            }),
          ),
          el('div.card__body', {},
            guardians.length > 0
              ? el('div', {}, ...guardians.map(renderGuardianRow))
              : emptyState({
                  icon: '👨‍👩‍👧',
                  title: 'هنوز کسی به شما دسترسی ندارد',
                  text: 'یک کد دعوت بسازید و به عضو خانواده بدهید تا بتواند موقعیت شما را ببیند.',
                  action: { label: 'ساخت کد دعوت', onClick: openInviteDialog },
                }),
          ),
        ),

        renderActiveInvites(),

        el('div.card', {},
          el('div.card__header', {},
            el('h2.card__title', { text: 'کسانی که مراقبشان هستم' }),
            el('div.header-spacer'),
            el('button.btn.btn--secondary.btn--sm', {
              type: 'button',
              text: 'وارد کردن کد دعوت',
              onClick: openRedeemDialog,
            }),
          ),
          el('div.card__body', {},
            primaries.length > 0
              ? el('div', {}, ...primaries.map(renderPrimaryRow))
              : emptyState({
                  icon: '🔗',
                  title: 'به کسی متصل نیستید',
                  text: 'اگر کد دعوتی دریافت کرده‌اید، اینجا واردش کنید.',
                  action: { label: 'وارد کردن کد دعوت', onClick: openRedeemDialog },
                }),
          ),
        ),
      ),
    );
  }

  async function load({ silent = false } = {}) {
    if (!silent && container.childElementCount === 0) {
      render(container, ...skeleton('card', 2));
    }

    try {
      const [links, inviteResult] = await Promise.all([
        api.guardianships(),
        api.listInvites().catch(() => ({ invites: [] })),
      ]);

      guardians = links.guardians ?? [];
      primaries = links.primaries ?? [];
      invites = inviteResult.invites ?? [];

      renderAll();
    } catch (error) {
      render(container, errorState({ text: error.message, onRetry: () => load() }));
    }
  }

  unsubscribers.push(
    realtime.on(WS_EVENTS.PRESENCE, (payload) => {
      if (payload?.type) load({ silent: true });
    }),
  );

  load();

  return () => {
    destroyed = true;
    unsubscribers.forEach((fn) => fn());
  };
}

export default mountFamily;
