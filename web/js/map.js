/**
 * پوششی روی Leaflet برای نمایش موقعیت زنده، محدوده‌های امن و مسیر.
 *
 * چرا OpenStreetMap و نه Google Maps:
 *   نقشه‌ی Google به کلید API و فعال‌سازی صورتحساب نیاز دارد. برای دموی
 *   قابل‌اجرا روی هر ماشینی، این یعنی یک مانع اضافه. OSM بدون کلید کار
 *   می‌کند و برای نمایش موقعیت در شهر، دقتش کاملاً کافی است.
 *
 * تنها چیزی که در این ماژول به اینترنت نیاز دارد، کاشی‌های نقشه است؛
 * خودِ کتابخانه به‌صورت محلی سرو می‌شود.
 */

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '© مشارکت‌کنندگان OpenStreetMap';

const TEHRAN = [35.7219, 51.3347];

export class SafeMap {
  /**
   * @param {HTMLElement} container
   * @param {{zoom?: number, center?: [number, number], interactive?: boolean}} [options]
   */
  constructor(container, options = {}) {
    const L = window.L;

    this.L = L;
    this.map = L.map(container, {
      center: options.center ?? TEHRAN,
      zoom: options.zoom ?? 15,
      zoomControl: false,
      attributionControl: true,
      // در چیدمان راست‌چین، کنترل‌ها سمت چپ بهتر می‌نشینند
      ...options.mapOptions,
    });

    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: TILE_ATTRIBUTION,
    }).addTo(this.map);

    L.control.zoom({ position: 'bottomleft' }).addTo(this.map);

    /** @type {Map<string, any>} نشانگر هر کاربر */
    this.userMarkers = new Map();
    /** @type {Map<string, any>} دایره‌ی هر محدوده */
    this.zoneLayers = new Map();

    this.trackLayer = null;
    this.previewCircle = null;
    this.hasFitted = false;
  }

  /** اندازه‌ی نقشه پس از تغییر چیدمان باید دوباره محاسبه شود. */
  invalidate() {
    setTimeout(() => this.map.invalidateSize(), 60);
  }

  destroy() {
    this.map.remove();
  }

  /* ─────────────────────── نشانگر کاربر ─────────────────────── */

  /**
   * قرار دادن یا جابه‌جا کردن نشانگر یک کاربر.
   * جابه‌جایی با انتقال نرم CSS انجام می‌شود، نه پرش ناگهانی.
   *
   * @param {string} userId
   * @param {{lat: number, lng: number}} position
   * @param {{status?: string, label?: string, isSimulated?: boolean, color?: string}} [meta]
   */
  setUserMarker(userId, position, meta = {}) {
    const { L } = this;
    const statusClass =
      meta.status === 'sos' ? 'user-marker--sos'
        : meta.status === 'outside' ? 'user-marker--outside'
          : '';

    const existing = this.userMarkers.get(userId);

    if (existing) {
      existing.marker.setLatLng([position.lat, position.lng]);
      const iconEl = existing.marker.getElement();
      if (iconEl) {
        const dot = iconEl.querySelector('.user-marker');
        if (dot) dot.className = `user-marker ${statusClass}`;
      }
      if (meta.label) existing.marker.setTooltipContent(meta.label);
      return existing.marker;
    }

    const icon = L.divIcon({
      className: 'smooth-marker',
      html: `<div class="user-marker ${statusClass}"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });

    const marker = L.marker([position.lat, position.lng], {
      icon,
      keyboard: true,
      alt: meta.label ?? 'موقعیت کاربر',
    }).addTo(this.map);

    if (meta.label) {
      marker.bindTooltip(meta.label, { direction: 'top', offset: [0, -14] });
    }

    this.userMarkers.set(userId, { marker });
    return marker;
  }

  removeUserMarker(userId) {
    const existing = this.userMarkers.get(userId);
    if (existing) {
      this.map.removeLayer(existing.marker);
      this.userMarkers.delete(userId);
    }
  }

  clearUserMarkers() {
    for (const userId of [...this.userMarkers.keys()]) this.removeUserMarker(userId);
  }

  /* ─────────────────────── محدوده‌های امن ─────────────────────── */

  /**
   * رسم محدوده‌ها.
   * علاوه بر خود محدوده، آستانه‌ی خروج هم با خط‌چین نازک نمایش داده می‌شود —
   * این همان چیزی است که هیسترزیس را برای بیننده قابل درک می‌کند.
   */
  setZones(zones, { showThresholds = false } = {}) {
    const { L } = this;

    for (const layer of this.zoneLayers.values()) this.map.removeLayer(layer);
    this.zoneLayers.clear();

    for (const zone of zones) {
      const group = L.layerGroup();

      L.circle([zone.centerLat, zone.centerLng], {
        radius: zone.radiusM,
        color: zone.color ?? '#2F6FED',
        weight: 2,
        opacity: zone.isActive === false ? 0.35 : 0.9,
        fillColor: zone.color ?? '#2F6FED',
        fillOpacity: zone.isActive === false ? 0.04 : 0.1,
      })
        .bindTooltip(zone.name, { permanent: false, direction: 'center' })
        .addTo(group);

      if (showThresholds && zone.thresholds) {
        L.circle([zone.centerLat, zone.centerLng], {
          radius: zone.thresholds.exitThresholdM,
          color: zone.color ?? '#2F6FED',
          weight: 1,
          opacity: 0.45,
          dashArray: '5 6',
          fill: false,
        }).addTo(group);
      }

      group.addTo(this.map);
      this.zoneLayers.set(zone.id, group);
    }
  }

  /* ─────────────────────── مسیر ─────────────────────── */

  /**
   * رسم مسیر با گرادیان زمانی: نقاط قدیمی کم‌رنگ و کم‌عرض،
   * نقاط تازه پررنگ و ضخیم. مسیر به قطعات تقسیم می‌شود چون
   * Leaflet برای یک polyline فقط یک رنگ می‌پذیرد.
   */
  setTrack(points, { color = '#2F6FED', segments = 24 } = {}) {
    const { L } = this;

    if (this.trackLayer) {
      this.map.removeLayer(this.trackLayer);
      this.trackLayer = null;
    }

    if (!points || points.length < 2) return;

    const group = L.layerGroup();
    const chunkSize = Math.max(2, Math.ceil(points.length / segments));

    for (let i = 0; i < points.length - 1; i += chunkSize - 1) {
      const chunk = points.slice(i, i + chunkSize);
      if (chunk.length < 2) break;

      const progress = i / Math.max(1, points.length - 1);

      L.polyline(
        chunk.map((p) => [p.lat, p.lng]),
        {
          color,
          weight: 3 + progress * 3,
          opacity: 0.28 + progress * 0.62,
          lineCap: 'round',
          lineJoin: 'round',
        },
      ).addTo(group);
    }

    // نقطه‌ی شروع و پایان مسیر
    const first = points[0];
    const last = points[points.length - 1];

    L.circleMarker([first.lat, first.lng], {
      radius: 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1,
    }).bindTooltip('شروع مسیر').addTo(group);

    L.circleMarker([last.lat, last.lng], {
      radius: 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1,
    }).bindTooltip('پایان مسیر').addTo(group);

    group.addTo(this.map);
    this.trackLayer = group;
  }

  clearTrack() {
    if (this.trackLayer) {
      this.map.removeLayer(this.trackLayer);
      this.trackLayer = null;
    }
  }

  /* ─────────────────────── پیش‌نمایش محدوده ─────────────────────── */

  /** دایره‌ی زنده هنگام ساخت محدوده‌ی جدید (کشیدن اسلایدر شعاع). */
  setPreviewCircle(center, radiusM) {
    const { L } = this;

    if (!this.previewCircle) {
      this.previewCircle = L.circle([center.lat, center.lng], {
        radius: radiusM,
        color: '#2F6FED',
        weight: 2,
        dashArray: '6 5',
        fillColor: '#2F6FED',
        fillOpacity: 0.12,
      }).addTo(this.map);
    } else {
      this.previewCircle.setLatLng([center.lat, center.lng]);
      this.previewCircle.setRadius(radiusM);
    }

    return this.previewCircle;
  }

  clearPreviewCircle() {
    if (this.previewCircle) {
      this.map.removeLayer(this.previewCircle);
      this.previewCircle = null;
    }
  }

  /* ─────────────────────── دوربین ─────────────────────── */

  panTo(position, zoom) {
    this.map.setView([position.lat, position.lng], zoom ?? this.map.getZoom(), {
      animate: true,
      duration: 0.4,
    });
  }

  /**
   * قاب‌بندی روی همه‌ی محتوا.
   * فقط بار اول به‌صورت خودکار انجام می‌شود؛ بعد از آن اگر کاربر نقشه را
   * جابه‌جا کرده باشد، هر پینگ جدید دوربین را از دستش می‌گرفت.
   */
  fitAll({ force = false, maxZoom = 16 } = {}) {
    if (this.hasFitted && !force) return;

    const { L } = this;
    const bounds = L.latLngBounds([]);

    for (const { marker } of this.userMarkers.values()) bounds.extend(marker.getLatLng());
    for (const group of this.zoneLayers.values()) {
      group.eachLayer((layer) => {
        if (layer.getBounds) bounds.extend(layer.getBounds());
      });
    }
    if (this.trackLayer) {
      this.trackLayer.eachLayer((layer) => {
        if (layer.getBounds) bounds.extend(layer.getBounds());
        else if (layer.getLatLng) bounds.extend(layer.getLatLng());
      });
    }

    if (bounds.isValid()) {
      this.map.fitBounds(bounds, { padding: [48, 48], maxZoom });
      this.hasFitted = true;
    }
  }

  /** ثبت کلیک روی نقشه — برای انتخاب مرکز محدوده. */
  onClick(handler) {
    this.map.on('click', (event) => handler({ lat: event.latlng.lat, lng: event.latlng.lng }));
  }
}

export default SafeMap;
