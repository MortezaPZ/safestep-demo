/**
 * تعریف تمام مسیرهای API نسخه‌ی ۱.
 *
 * هر مسیر سه چیز را صریح اعلام می‌کند: احراز هویت، اعتبارسنجی ورودی و
 * محدودیت نرخ. با یک نگاه به این فایل می‌توان دید هر endpoint چه چیزی
 * می‌خواهد و چه کسی اجازه‌ی صدا زدنش را دارد.
 */
import { Router } from 'express';
import { z } from 'zod';

import * as authController from '../controllers/authController.js';
import {
  guardianship,
  location,
  safeZone,
  alert,
  sos,
  settings,
  device,
  simulator,
} from '../controllers/index.js';

import { requireAuth } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validate.js';
import { authLimiter, sosLimiter, inviteLimiter, generalLimiter } from '../middleware/rateLimit.js';
import { ALL_ALERT_TYPES } from '../config/constants.js';

const router = Router();

/* ═══════════════════════════ احراز هویت ═══════════════════════════ */

router.post(
  '/auth/register',
  authLimiter,
  validate({
    body: z.object({
      phone: schemas.phone,
      password: schemas.password,
      fullName: schemas.fullName,
      role: z.enum(['primary', 'guardian']).default('primary'),
    }),
  }),
  authController.register,
);

router.post(
  '/auth/login',
  authLimiter,
  validate({
    body: z.object({
      phone: schemas.phone,
      password: z.string().min(1, 'رمز عبور را وارد کنید.'),
    }),
  }),
  authController.login,
);

router.post(
  '/auth/refresh',
  validate({ body: z.object({ refreshToken: z.string().min(10, 'توکن معتبر نیست.') }) }),
  authController.refresh,
);

router.post(
  '/auth/logout',
  validate({ body: z.object({ refreshToken: z.string().optional() }) }),
  authController.logout,
);

router.post('/auth/logout-all', requireAuth, authController.logoutAll);
router.get('/auth/me', requireAuth, authController.me);

/* ═══════════════════════ سرپرستی و کد دعوت ═══════════════════════ */

router.post(
  '/guardianships/invites',
  requireAuth,
  inviteLimiter,
  validate({ body: z.object({ permissions: schemas.permissions }) }),
  guardianship.createInvite,
);

router.get('/guardianships/invites', requireAuth, guardianship.listInvites);

router.delete(
  '/guardianships/invites/:id',
  requireAuth,
  validate({ params: z.object({ id: schemas.uuid }) }),
  guardianship.cancelInvite,
);

router.post(
  '/guardianships/redeem',
  requireAuth,
  inviteLimiter,
  validate({ body: z.object({ code: schemas.inviteCode }) }),
  guardianship.redeem,
);

router.get('/guardianships', requireAuth, guardianship.list);

router.patch(
  '/guardianships/:id',
  requireAuth,
  validate({
    params: z.object({ id: schemas.uuid }),
    body: z.object({ permissions: schemas.permissions }),
  }),
  guardianship.updatePermissions,
);

router.delete(
  '/guardianships/:id',
  requireAuth,
  validate({ params: z.object({ id: schemas.uuid }) }),
  guardianship.revoke,
);

/* ═══════════════════════════ موقعیت ═══════════════════════════ */

router.post(
  '/locations/ping',
  requireAuth,
  generalLimiter,
  validate({
    body: z.object({
      lat: schemas.lat,
      lng: schemas.lng,
      accuracyM: z.number().min(0).max(10_000).optional(),
      speedMps: z.number().min(0).max(200).optional(),
      headingDeg: z.number().min(0).max(360).optional(),
      batteryLevel: z.number().int().min(0).max(100).optional(),
      isSimulated: z.boolean().default(false),
      recordedAt: z.coerce.date().optional(),
    }),
  }),
  location.ping,
);

router.get('/locations/status', requireAuth, location.ownStatus);
router.get('/locations/watching', requireAuth, location.watchList);

router.get(
  '/locations/current',
  requireAuth,
  validate({ query: z.object({ userId: schemas.uuid.optional() }) }),
  location.current,
);

router.get(
  '/locations/history',
  requireAuth,
  validate({
    query: z.object({
      userId: schemas.uuid.optional(),
      from: schemas.isoDate,
      to: schemas.isoDate,
      limit: schemas.numericQuery(1, 5000, 2000),
    }),
  }),
  location.history,
);

router.get(
  '/locations/history/days',
  requireAuth,
  validate({ query: z.object({ userId: schemas.uuid.optional() }) }),
  location.historyDays,
);

router.delete(
  '/locations/history',
  requireAuth,
  validate({
    query: z.object({
      from: schemas.isoDate.optional(),
      to: schemas.isoDate.optional(),
    }),
  }),
  location.deleteHistory,
);

router.put(
  '/locations/sharing',
  requireAuth,
  validate({ body: z.object({ enabled: z.boolean() }) }),
  location.setSharing,
);

/* ═══════════════════════ محدوده‌های امن ═══════════════════════ */

const safeZoneBody = {
  name: z.string().trim().min(1, 'نام محدوده را وارد کنید.').max(60, 'نام بیش از حد طولانی است.'),
  centerLat: schemas.lat,
  centerLng: schemas.lng,
  radiusM: schemas.radiusM,
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'کد رنگ معتبر نیست.').optional(),
  icon: z.string().max(32).optional(),
};

router.get('/safe-zones', requireAuth, safeZone.list);

router.post(
  '/safe-zones',
  requireAuth,
  validate({ body: z.object(safeZoneBody) }),
  safeZone.create,
);

router.post(
  '/safe-zones/preview',
  requireAuth,
  validate({
    body: z.object({
      centerLat: schemas.lat,
      centerLng: schemas.lng,
      radiusM: schemas.radiusM,
    }),
  }),
  safeZone.preview,
);

router.patch(
  '/safe-zones/:id',
  requireAuth,
  validate({
    params: z.object({ id: schemas.uuid }),
    body: z.object({
      name: safeZoneBody.name.optional(),
      centerLat: schemas.lat.optional(),
      centerLng: schemas.lng.optional(),
      radiusM: schemas.radiusM.optional(),
      isActive: z.boolean().optional(),
      color: safeZoneBody.color,
      icon: safeZoneBody.icon,
    }),
  }),
  safeZone.update,
);

router.delete(
  '/safe-zones/:id',
  requireAuth,
  validate({ params: z.object({ id: schemas.uuid }) }),
  safeZone.remove,
);

/* ═══════════════════════════ هشدارها ═══════════════════════════ */

router.get(
  '/alerts',
  requireAuth,
  validate({
    query: z.object({
      userId: schemas.uuid.optional(),
      types: z
        .string()
        .optional()
        .refine(
          (v) => !v || v.split(',').every((t) => ALL_ALERT_TYPES.includes(t.trim())),
          { message: 'نوع هشدار نامعتبر است.' },
        ),
      unreadOnly: z
        .union([z.string(), z.boolean()])
        .optional()
        .transform((v) => v === true || v === 'true'),
      limit: schemas.numericQuery(1, 500, 100),
      before: schemas.isoDate.optional(),
    }),
  }),
  alert.list,
);

router.post(
  '/alerts/:id/read',
  requireAuth,
  validate({ params: z.object({ id: schemas.uuid }) }),
  alert.markRead,
);

router.post('/alerts/read-all', requireAuth, alert.markAllRead);

router.post(
  '/alerts/:id/resolve',
  requireAuth,
  validate({ params: z.object({ id: schemas.uuid }) }),
  alert.resolve,
);

/* ═══════════════════════════ SOS ═══════════════════════════ */

router.post(
  '/sos',
  requireAuth,
  sosLimiter,
  validate({
    body: z.object({
      lat: schemas.lat.optional(),
      lng: schemas.lng.optional(),
      accuracyM: z.number().min(0).max(10_000).optional(),
      batteryLevel: z.number().int().min(0).max(100).optional(),
      isSimulated: z.boolean().default(false),
      note: z.string().max(280, 'یادداشت بیش از حد طولانی است.').optional(),
    }),
  }),
  sos.trigger,
);

router.get('/sos/contacts', requireAuth, sos.contacts);
router.get('/sos/config', requireAuth, sos.config);

router.get(
  '/sos/active',
  requireAuth,
  validate({ query: z.object({ userId: schemas.uuid.optional() }) }),
  sos.active,
);

/* ═══════════════════════════ تنظیمات ═══════════════════════════ */

router.get('/settings', requireAuth, settings.get);

router.patch(
  '/settings',
  requireAuth,
  validate({
    body: z.object({
      locationSharingEnabled: z.boolean().optional(),
      longStopMinutes: z.number().int().min(1).max(240).optional(),
      longStopRadiusM: z.number().int().min(5).max(500).optional(),
      alertTypes: z.array(z.enum(ALL_ALERT_TYPES)).optional(),
      theme: z.enum(['light', 'dark', 'system']).optional(),
      language: z.enum(['fa', 'en']).optional(),
    }),
  }),
  settings.update,
);

/* ═══════════════════════════ دستگاه‌ها ═══════════════════════════ */

router.post(
  '/devices',
  requireAuth,
  validate({
    body: z.object({
      platform: z.enum(['android', 'ios', 'web']),
      pushToken: z.string().max(512).optional(),
      deviceName: z.string().max(80).optional(),
      batteryLevel: z.number().int().min(0).max(100).optional(),
    }),
  }),
  device.register,
);

router.get('/devices', requireAuth, device.list);

router.delete(
  '/devices/:id',
  requireAuth,
  validate({ params: z.object({ id: schemas.uuid }) }),
  device.remove,
);

/* ═══════════════════ شبیه‌ساز موقعیت (حالت نمایش) ═══════════════════ */

router.get('/simulator/routes', requireAuth, simulator.routes);

router.post(
  '/simulator/start',
  requireAuth,
  validate({
    body: z.object({
      routeId: z.string().min(1, 'مسیر را انتخاب کنید.'),
      speedMultiplier: z.number().min(1).max(40).default(8),
      batteryLevel: z.number().int().min(0).max(100).default(78),
    }),
  }),
  simulator.start,
);

router.post('/simulator/stop', requireAuth, simulator.stop);
router.get('/simulator/status', requireAuth, simulator.status);

export default router;
