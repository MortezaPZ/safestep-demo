/**
 * کلاینت REST.
 *
 * دو مسئولیت اصلی:
 *   ۱) نگهداری توکن‌ها و تازه‌سازی خودکار access token هنگام انقضا
 *   ۲) تبدیل خطاهای HTTP به خطای جاوااسکریپت با پیام فارسیِ سرور
 *
 * تازه‌سازی به‌صورت «یک بار برای همه» انجام می‌شود: اگر چند درخواست
 * همزمان با ۴۰۱ برگردند، تنها یک درخواست refresh فرستاده می‌شود و بقیه
 * منتظر همان می‌مانند. بدون این، هر بار انقضای توکن یک رگبار درخواست
 * refresh تولید می‌کرد که سرور همه را جز اولی رد می‌کند.
 */

const BASE = '/api/v1';
const STORAGE_KEY = 'safestep.session';

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/* ─────────────────────────── نگهداری نشست ─────────────────────────── */

let session = null;
let refreshPromise = null;

/** خواندن نشست ذخیره‌شده هنگام بارگذاری صفحه. */
export function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    session = raw ? JSON.parse(raw) : null;
  } catch {
    session = null;
  }
  return session;
}

export function saveSession(data) {
  session = {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    user: data.user,
    settings: data.settings ?? session?.settings ?? null,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function clearSession() {
  session = null;
  localStorage.removeItem(STORAGE_KEY);
}

export const getSession = () => session;
export const getUser = () => session?.user ?? null;
export const getAccessToken = () => session?.accessToken ?? null;
export const isLoggedIn = () => Boolean(session?.accessToken);

/** به‌روزرسانی تنظیمات ذخیره‌شده بدون دست زدن به توکن‌ها. */
export function patchStoredSettings(settings) {
  if (!session) return;
  session.settings = settings;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

/* ─────────────────────────── درخواست ─────────────────────────── */

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function doFetch(path, { method = 'GET', body, query, auth = true } = {}) {
  const url = new URL(BASE + path, window.location.origin);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    }
  }

  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && session?.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = await parseResponse(response);

  if (!response.ok) {
    const error = data?.error ?? {};
    throw new ApiError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.message ?? 'ارتباط با سرور برقرار نشد.',
      error.details,
    );
  }

  return data;
}

/** تازه‌سازی توکن — تنها یک درخواست همزمان مجاز است. */
async function refreshAccessToken() {
  if (!session?.refreshToken) throw new ApiError(401, 'UNAUTHORIZED', 'نشست شما منقضی شده است.');

  if (!refreshPromise) {
    refreshPromise = doFetch('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: session.refreshToken },
      auth: false,
    })
      .then((data) => {
        saveSession({ ...data, settings: session?.settings });
        return data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

/**
 * درخواست با تازه‌سازی خودکار.
 * فقط یک بار تلاش مجدد می‌کند؛ اگر باز هم ۴۰۱ شد، نشست واقعاً باطل است.
 */
async function request(path, options = {}) {
  try {
    return await doFetch(path, options);
  } catch (error) {
    const canRetry = error.status === 401 && options.auth !== false && session?.refreshToken;
    if (!canRetry) throw error;

    try {
      await refreshAccessToken();
    } catch {
      clearSession();
      window.dispatchEvent(new CustomEvent('safestep:session-expired'));
      throw error;
    }

    return doFetch(path, options);
  }
}

/* ═══════════════════════════ واسط API ═══════════════════════════ */

export const api = {
  ApiError,

  /* ─── احراز هویت ─── */
  async register(payload) {
    const data = await request('/auth/register', { method: 'POST', body: payload, auth: false });
    return saveSession(data);
  },

  async login(phone, password) {
    const data = await request('/auth/login', {
      method: 'POST',
      body: { phone, password },
      auth: false,
    });
    return saveSession(data);
  },

  async logout() {
    try {
      await request('/auth/logout', {
        method: 'POST',
        body: { refreshToken: session?.refreshToken },
      });
    } finally {
      clearSession();
    }
  },

  me: () => request('/auth/me'),

  /* ─── موقعیت ─── */
  ownStatus: () => request('/locations/status'),
  watchList: () => request('/locations/watching'),
  currentLocation: (userId) => request('/locations/current', { query: { userId } }),

  ping: (payload) => request('/locations/ping', { method: 'POST', body: payload }),

  history: (userId, from, to, limit = 2000) =>
    request('/locations/history', {
      query: { userId, from: from.toISOString(), to: to.toISOString(), limit },
    }),

  historyDays: (userId) => request('/locations/history/days', { query: { userId } }),

  deleteHistory: (from, to) =>
    request('/locations/history', {
      method: 'DELETE',
      query: {
        from: from ? from.toISOString() : undefined,
        to: to ? to.toISOString() : undefined,
      },
    }),

  setSharing: (enabled) =>
    request('/locations/sharing', { method: 'PUT', body: { enabled } }),

  /* ─── محدوده‌های امن ─── */
  safeZones: () => request('/safe-zones'),
  createZone: (payload) => request('/safe-zones', { method: 'POST', body: payload }),
  updateZone: (id, patch) => request(`/safe-zones/${id}`, { method: 'PATCH', body: patch }),
  deleteZone: (id) => request(`/safe-zones/${id}`, { method: 'DELETE' }),
  previewZone: (payload) => request('/safe-zones/preview', { method: 'POST', body: payload }),

  /* ─── سرپرستی ─── */
  guardianships: () => request('/guardianships'),
  createInvite: (permissions) =>
    request('/guardianships/invites', { method: 'POST', body: { permissions } }),
  listInvites: () => request('/guardianships/invites'),
  cancelInvite: (id) => request(`/guardianships/invites/${id}`, { method: 'DELETE' }),
  redeemInvite: (code) => request('/guardianships/redeem', { method: 'POST', body: { code } }),
  updatePermissions: (id, permissions) =>
    request(`/guardianships/${id}`, { method: 'PATCH', body: { permissions } }),
  revokeGuardianship: (id) => request(`/guardianships/${id}`, { method: 'DELETE' }),

  /* ─── هشدارها ─── */
  alerts: (params = {}) => request('/alerts', { query: params }),
  markAlertRead: (id) => request(`/alerts/${id}/read`, { method: 'POST' }),
  markAllAlertsRead: () => request('/alerts/read-all', { method: 'POST' }),
  resolveAlert: (id) => request(`/alerts/${id}/resolve`, { method: 'POST' }),

  /* ─── SOS ─── */
  triggerSos: (payload = {}) => request('/sos', { method: 'POST', body: payload }),
  sosContacts: () => request('/sos/contacts'),
  sosConfig: () => request('/sos/config'),
  activeSos: (userId) => request('/sos/active', { query: { userId } }),

  /* ─── تنظیمات و دستگاه ─── */
  settings: () => request('/settings'),
  updateSettings: (patch) => request('/settings', { method: 'PATCH', body: patch }),
  registerDevice: (payload) => request('/devices', { method: 'POST', body: payload }),

  /* ─── شبیه‌ساز (حالت نمایش) ─── */
  simulatorRoutes: () => request('/simulator/routes'),
  startSimulator: (payload) => request('/simulator/start', { method: 'POST', body: payload }),
  stopSimulator: () => request('/simulator/stop', { method: 'POST' }),
  simulatorStatus: () => request('/simulator/status'),

  /* ─── سلامت ─── */
  health: () => fetch('/health').then((r) => r.json()),
};

export { ApiError };
export default api;
