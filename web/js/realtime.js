/**
 * اتصال زنده با WebSocket.
 *
 * پوششی نازک روی socket.io که سه کار می‌کند:
 *   ۱) توکن را هنگام اتصال می‌فرستد و پس از تازه‌سازی توکن، دوباره وصل می‌شود
 *   ۲) وضعیت اتصال را به‌صورت رویداد منتشر می‌کند تا رابط کاربری
 *      بتواند نشانگر «زنده / در حال اتصال / قطع» را نشان دهد
 *   ۳) شنونده‌ها را در یک جا نگه می‌دارد تا هنگام تعویض صفحه نشت نکنند
 */

export const WS_EVENTS = {
  LOCATION_UPDATE: 'location:update',
  ALERT_NEW: 'alert:new',
  ALERT_READ: 'alert:read',
  SHARING_CHANGED: 'sharing:changed',
  ZONE_STATE: 'zone:state',
  PRESENCE: 'presence',
  SIMULATOR_STATUS: 'simulator:status',
  NOTIFICATION: 'notification:push',
};

let socket = null;
let connectionState = 'disconnected';

const listeners = new Map();

function emitLocal(event, payload) {
  for (const handler of listeners.get(event) ?? []) {
    try {
      handler(payload);
    } catch (error) {
      console.error('خطا در پردازش رویداد زنده', event, error);
    }
  }
}

function setState(state) {
  if (connectionState === state) return;
  connectionState = state;
  emitLocal('connection', state);
}

/** برقراری اتصال با توکن فعلی. */
export function connect(token) {
  if (!token) return null;

  disconnect();

  // io از فایل vendor به‌صورت سراسری بارگذاری شده است
  socket = window.io({
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
  });

  setState('connecting');

  socket.on('connect', () => setState('connected'));
  socket.on('disconnect', () => setState('disconnected'));
  socket.on('connect_error', () => setState('error'));
  socket.io.on('reconnect_attempt', () => setState('connecting'));

  // بازپخش همه‌ی رویدادهای دامنه به شنونده‌های محلی
  for (const event of Object.values(WS_EVENTS)) {
    socket.on(event, (payload) => emitLocal(event, payload));
  }

  return socket;
}

export function disconnect() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  setState('disconnected');
}

/** اتصال دوباره با توکن تازه — پس از refresh صدا زده می‌شود. */
export function reconnect(token) {
  return connect(token);
}

/**
 * ثبت شنونده.
 * @returns {Function} تابع لغو ثبت
 */
export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

/** حذف همه‌ی شنونده‌های یک رویداد. */
export function off(event) {
  listeners.delete(event);
}

export const getConnectionState = () => connectionState;
export const isConnected = () => connectionState === 'connected';

export const CONNECTION_LABELS = {
  connected: { text: 'زنده', className: 'chip--safe', dot: '●' },
  connecting: { text: 'در حال اتصال…', className: '', dot: '◐' },
  disconnected: { text: 'قطع', className: 'chip--warn', dot: '○' },
  error: { text: 'خطای اتصال', className: 'chip--danger', dot: '✕' },
};

export default { connect, disconnect, reconnect, on, off, getConnectionState, isConnected, WS_EVENTS };
