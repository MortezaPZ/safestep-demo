/**
 * صفحه‌ی محدوده‌های امن.
 *
 * ساخت محدوده با لمس روی نقشه انجام می‌شود و اسلایدر شعاع، دایره را
 * به‌صورت زنده تغییر می‌دهد. پیش‌نمایش سرور هم می‌گوید «با این شعاع،
 * همین حالا داخل هستی یا بیرون» — قبل از اینکه چیزی ذخیره شود.
 *
 * دایره‌ی خط‌چین دور هر محدوده، آستانه‌ی خروج (شعاع + هیسترزیس) است.
 * این را عمداً نشان می‌دهیم: کاربر باید بفهمد چرا دقیقاً روی خط محدوده
 * هشدار نمی‌گیرد، وگرنه فکر می‌کند سیستم خراب است.
 */
import api from '../api.js';
import SafeMap from '../map.js';
import { el, render, toast, dialog, confirmDialog, skeleton, emptyState, errorState } from '../ui.js';
import { faDistance, faNumber, ZONE_ICONS } from '../format.js';

const ZONE_COLORS = ['#2F6FED', '#00897B', '#7C4DFF', '#F4511E', '#C2185B'];

export function mountZones(container, ctx) {
  let zones = [];
  let currentLocation = null;
  let map = null;
  let destroyed = false;

  /* ─────────────────────── ساخت / ویرایش ─────────────────────── */

  function openZoneEditor(existing = null) {
    const isEdit = Boolean(existing);

    let center = existing
      ? { lat: existing.centerLat, lng: existing.centerLng }
      : currentLocation
        ? { lat: currentLocation.lat, lng: currentLocation.lng }
        : { lat: 35.7219, lng: 51.3347 };

    let radius = existing?.radiusM ?? 150;
    let color = existing?.color ?? ZONE_COLORS[zones.length % ZONE_COLORS.length];
    let icon = existing?.icon ?? 'home';

    const nameInput = el('input.input', {
      type: 'text',
      value: existing?.name ?? '',
      placeholder: 'مثلاً: خانه، مرکز درمانی، خانه‌ی دخترم',
      ariaLabel: 'نام محدوده',
    });

    const radiusValue = el('span.font-bold', { text: faDistance(radius) });
    const previewInfo = el('div.text-xs.text-muted', {
      text: 'برای جابه‌جایی مرکز، روی نقشه لمس کنید.',
    });

    const radiusSlider = el('input.slider', {
      type: 'range',
      min: '50',
      max: '2000',
      step: '10',
      value: String(radius),
      ariaLabel: 'شعاع محدوده بر حسب متر',
    });

    const editorMapEl = el('div', {
      style: { height: '300px', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
    });

    let editorMap = null;

    /** پیش‌نمایش سرور: با این شعاع، کاربر داخل است یا بیرون؟ */
    async function refreshPreview() {
      radiusValue.textContent = faDistance(radius);
      editorMap?.setPreviewCircle(center, radius);

      try {
        const preview = await api.previewZone({
          centerLat: center.lat,
          centerLng: center.lng,
          radiusM: radius,
        });

        if (preview.currentDistanceM === null) {
          previewInfo.textContent = preview.note ?? 'موقعیتی برای مقایسه ثبت نشده است.';
          return;
        }

        previewInfo.textContent =
          `فاصله‌ی فعلی شما از مرکز: ${faDistance(preview.currentDistanceM)} — ` +
          `${preview.wouldBeInside ? 'با این شعاع داخل محدوده هستید' : 'با این شعاع بیرون از محدوده هستید'}. ` +
          `آستانه‌ی خروج: ${faDistance(preview.thresholds.exitThresholdM)}`;
      } catch {
        previewInfo.textContent = 'پیش‌نمایش در دسترس نیست.';
      }
    }

    radiusSlider.addEventListener('input', () => {
      radius = Number(radiusSlider.value);
      radiusValue.textContent = faDistance(radius);
      editorMap?.setPreviewCircle(center, radius);
    });
    radiusSlider.addEventListener('change', refreshPreview);

    const iconRow = el('div.chip-row', {},
      ...Object.entries(ZONE_ICONS).map(([key, emoji]) =>
        el('button', {
          class: 'chip chip--button',
          type: 'button',
          ariaPressed: String(key === icon),
          text: emoji,
          onClick: (event) => {
            icon = key;
            [...iconRow.children].forEach((child) => child.setAttribute('aria-pressed', 'false'));
            event.currentTarget.setAttribute('aria-pressed', 'true');
          },
        }),
      ),
    );

    const colorRow = el('div.chip-row', {},
      ...ZONE_COLORS.map((option) =>
        el('button', {
          class: 'chip chip--button',
          type: 'button',
          ariaPressed: String(option === color),
          style: { background: option, borderColor: option, color: '#fff', minWidth: '52px' },
          text: ' ',
          ariaLabel: `رنگ ${option}`,
          onClick: (event) => {
            color = option;
            [...colorRow.children].forEach((child) => child.setAttribute('aria-pressed', 'false'));
            event.currentTarget.setAttribute('aria-pressed', 'true');
          },
        }),
      ),
    );

    const { close } = dialog({
      title: isEdit ? 'ویرایش محدوده‌ی امن' : 'محدوده‌ی امن جدید',
      content: el('div', {},
        el('div.field', {},
          el('label.field__label', { text: 'نام محدوده' }),
          nameInput,
        ),
        editorMapEl,
        el('div.field.mt-4', {},
          el('label.field__label', {},
            'شعاع: ', radiusValue,
          ),
          radiusSlider,
        ),
        previewInfo,
        el('div.field.mt-4', {},
          el('label.field__label', { text: 'آیکون' }),
          iconRow,
        ),
        el('div.field', {},
          el('label.field__label', { text: 'رنگ' }),
          colorRow,
        ),
      ),
      actions: [
        { label: 'انصراف', variant: 'secondary', onClick: (closeDialog) => closeDialog() },
        {
          label: isEdit ? 'ذخیره‌ی تغییرات' : 'ساخت محدوده',
          onClick: async () => {
            const name = nameInput.value.trim();
            if (name.length < 1) {
              toast('نام لازم است', 'برای محدوده یک نام بگذارید.', { severity: 'warning' });
              return;
            }

            try {
              if (isEdit) {
                await api.updateZone(existing.id, {
                  name,
                  centerLat: center.lat,
                  centerLng: center.lng,
                  radiusM: radius,
                  color,
                  icon,
                });
                toast('ذخیره شد', 'محدوده به‌روزرسانی شد.');
              } else {
                await api.createZone({
                  name,
                  centerLat: center.lat,
                  centerLng: center.lng,
                  radiusM: radius,
                  color,
                  icon,
                });
                toast('ساخته شد', `محدوده‌ی «${name}» اضافه شد.`);
              }

              close();
              await load();
            } catch (error) {
              toast('ذخیره ناموفق بود', error.message, { severity: 'warning' });
            }
          },
        },
      ],
    });

    // نقشه‌ی ویرایشگر پس از افزوده شدن دیالوگ به DOM ساخته می‌شود
    queueMicrotask(() => {
      editorMap = new SafeMap(editorMapEl, { center: [center.lat, center.lng], zoom: 15 });
      editorMap.setPreviewCircle(center, radius);

      if (currentLocation) {
        editorMap.setUserMarker('me', currentLocation, { label: 'موقعیت فعلی شما' });
      }

      editorMap.onClick((point) => {
        center = point;
        editorMap.setPreviewCircle(center, radius);
        refreshPreview();
      });

      editorMap.invalidate();
      refreshPreview();
    });
  }

  async function toggleZone(zone) {
    try {
      await api.updateZone(zone.id, { isActive: !zone.isActive });
      toast(
        zone.isActive ? 'محدوده غیرفعال شد' : 'محدوده فعال شد',
        zone.isActive ? 'دیگر برای این محدوده هشدار داده نمی‌شود.' : 'هشدارهای این محدوده دوباره فعال شد.',
      );
      await load();
    } catch (error) {
      toast('عملیات ناموفق بود', error.message, { severity: 'warning' });
    }
  }

  async function removeZone(zone) {
    const confirmed = await confirmDialog({
      title: 'حذف محدوده؟',
      message: `محدوده‌ی «${zone.name}» و تمام وضعیت مربوط به آن حذف می‌شود. این کار قابل بازگشت نیست.`,
      confirmLabel: 'حذف کن',
    });

    if (!confirmed) return;

    try {
      await api.deleteZone(zone.id);
      toast('حذف شد');
      await load();
    } catch (error) {
      toast('حذف ناموفق بود', error.message, { severity: 'warning' });
    }
  }

  /* ─────────────────────── چیدمان ─────────────────────── */

  function renderZoneRow(zone) {
    return el('div.list-row', {},
      el('div.alert-icon', {
        text: ZONE_ICONS[zone.icon] ?? '📍',
        ariaHidden: 'true',
        style: { background: `${zone.color}22`, color: zone.color },
      }),
      el('div.list-row__main', {},
        el('div.list-row__title', { text: zone.name }),
        el('div.list-row__sub', {
          text: `شعاع ${faDistance(zone.radiusM)} · آستانه‌ی خروج ${faDistance(zone.thresholds.exitThresholdM)} · آستانه‌ی بازگشت ${faDistance(zone.thresholds.enterThresholdM)}`,
        }),
        el('div.chip-row', {},
          el('span', {
            class: `chip ${zone.isActive ? 'chip--safe' : ''}`,
            text: zone.isActive ? 'فعال' : 'غیرفعال',
          }),
          zone.currentDistanceM !== undefined
            ? el('span.chip', { text: `فاصله‌ی فعلی: ${faDistance(zone.currentDistanceM)}` })
            : null,
        ),
      ),
      el('div.list-row__actions', {},
        el('button.btn.btn--secondary.btn--sm', {
          type: 'button',
          text: 'ویرایش',
          onClick: () => openZoneEditor(zone),
        }),
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: zone.isActive ? 'غیرفعال' : 'فعال',
          onClick: () => toggleZone(zone),
        }),
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'حذف',
          onClick: () => removeZone(zone),
        }),
      ),
    );
  }

  function renderMapCard() {
    const mapEl = el('div.map', { role: 'application', ariaLabel: 'نقشه‌ی محدوده‌های امن' });

    queueMicrotask(() => {
      if (destroyed || !document.body.contains(mapEl)) return;

      map?.destroy();
      map = new SafeMap(mapEl, { zoom: 14 });
      map.setZones(zones, { showThresholds: true });

      if (currentLocation) {
        map.setUserMarker(ctx.user.id, currentLocation, { label: 'موقعیت فعلی شما' });
      }

      map.fitAll();
      map.invalidate();
    });

    return el('div.map-wrap', {},
      mapEl,
      el('div.map-overlay.map-overlay--bottom', {},
        el('span.map-badge', { text: '⭕ دایره‌ی پر: محدوده' }),
        el('span.map-badge', { text: '⭘ خط‌چین: آستانه‌ی خروج (هیسترزیس)' }),
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
            el('h2.card__title', { text: 'محدوده‌های امن' }),
            el('div.header-spacer'),
            el('button.btn.btn--sm', {
              type: 'button',
              text: '＋ محدوده‌ی جدید',
              onClick: () => openZoneEditor(),
            }),
          ),
          el('div', { style: { padding: 'var(--space-3)' } }, renderMapCard()),
          el('div.card__body', {},
            zones.length > 0
              ? el('div', {}, ...zones.map(renderZoneRow))
              : emptyState({
                  icon: '📍',
                  title: 'هنوز محدوده‌ای ندارید',
                  text: 'محدوده‌ی امن جایی است که رفت‌وآمد در آن عادی است. خروج از آن به خانواده اطلاع داده می‌شود.',
                  action: { label: 'ساخت اولین محدوده', onClick: () => openZoneEditor() },
                }),
          ),
        ),
      ),
    );
  }

  async function load() {
    if (container.childElementCount === 0) {
      render(container, el('div.skeleton.skeleton--map.mb-4'), ...skeleton('row', 3));
    }

    try {
      const [zoneResult, status] = await Promise.all([
        api.safeZones(),
        api.ownStatus().catch(() => null),
      ]);

      zones = zoneResult.zones ?? [];
      currentLocation = status?.location ?? null;

      renderAll();
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

export default mountZones;
