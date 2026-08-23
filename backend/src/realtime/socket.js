/**
 * لایه‌ی WebSocket با socket.io.
 *
 * مدل اتاق‌ها: هر کاربر پس از احراز هویت وارد اتاق ‎user:<id> می‌شود.
 * ارسال هدفمند یعنی انتشار در اتاق‌های همان کاربران — نه پخش سراسری.
 * این تصمیم مستقیماً امنیتی است: هیچ رویدادی به سوکتی که مخاطبش نیست نمی‌رسد.
 */
import { Server } from 'socket.io';
import env from '../config/env.js';
import { WS_EVENTS } from '../config/constants.js';
import { verifyAccessToken } from '../utils/jwt.js';
import logger from '../utils/logger.js';
import hub from './hub.js';

const log = logger.child({ module: 'socket' });

const roomFor = (userId) => `user:${userId}`;

/** شمارش سوکت‌های فعال هر کاربر (یک کاربر می‌تواند چند تب/دستگاه باز داشته باشد). */
const socketsByUser = new Map();

function trackConnect(userId, socketId) {
  const set = socketsByUser.get(userId) ?? new Set();
  set.add(socketId);
  socketsByUser.set(userId, set);
  return set.size;
}

function trackDisconnect(userId, socketId) {
  const set = socketsByUser.get(userId);
  if (!set) return 0;
  set.delete(socketId);
  if (set.size === 0) socketsByUser.delete(userId);
  return set.size;
}

/**
 * راه‌اندازی سرور WebSocket روی همان سرور HTTP.
 * @param {import('node:http').Server} httpServer
 */
export function attachSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.corsOrigins, credentials: true },
    // در شبکه‌های موبایل، افت اتصال عادی است؛ این مقادیر قطع کاذب را کم می‌کنند
    pingInterval: 20_000,
    pingTimeout: 25_000,
  });

  /**
   * احراز هویت پیش از برقراری اتصال.
   * توکن از handshake.auth خوانده می‌شود، نه از query string —
   * چون query string در لاگ سرورهای واسط ثبت می‌شود.
   */
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('توکن ارسال نشده است'));

      const payload = verifyAccessToken(token);
      socket.data.userId = payload.sub;
      socket.data.role = payload.role;
      return next();
    } catch {
      return next(new Error('توکن نامعتبر است'));
    }
  });

  io.on('connection', (socket) => {
    const { userId } = socket.data;
    socket.join(roomFor(userId));
    const activeCount = trackConnect(userId, socket.id);

    log.info('اتصال زنده برقرار شد', { userId, sockets: activeCount });

    // تأیید اتصال برای کلاینت، تا نشانگر «زنده» را روشن کند
    socket.emit(WS_EVENTS.PRESENCE, { status: 'connected', userId, at: new Date().toISOString() });

    /**
     * عضویت در اتاقِ یک کاربر اصلی برای دریافت رویدادهای او.
     * این‌جا صرفاً تأیید می‌کنیم؛ خودِ ارسال رویداد در سرویس‌ها بر اساس
     * سطح دسترسی فیلتر می‌شود، پس عضویت در اتاق به‌تنهایی چیزی فاش نمی‌کند.
     */
    socket.on('subscribe', (payload, ack) => {
      const subjectId = payload?.userId;
      if (typeof ack === 'function') {
        ack({ ok: Boolean(subjectId), subjectId: subjectId ?? null });
      }
    });

    socket.on('disconnect', (reason) => {
      const remaining = trackDisconnect(userId, socket.id);
      log.debug('اتصال زنده قطع شد', { userId, reason, remaining });
    });
  });

  // ثبت لایه‌ی انتقال در هاب تا سرویس‌ها بتوانند رویداد بفرستند
  hub.setTransport({
    emit(userIds, event, payload) {
      const rooms = userIds.map(roomFor);
      io.to(rooms).emit(event, payload);
      log.debug('رویداد زنده منتشر شد', { event, recipients: userIds.length });
    },
    connectedUserCount: () => socketsByUser.size,
    isUserOnline: (userId) => socketsByUser.has(userId),
  });

  log.info('سرور WebSocket آماده است');
  return io;
}

export default { attachSocket };
