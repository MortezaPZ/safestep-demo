/**
 * کنترلرهای سرپرستی، موقعیت، محدوده، هشدار، تنظیمات، دستگاه و شبیه‌ساز.
 *
 * این کنترلرها کوتاه‌اند چون تمام منطق در لایه‌ی سرویس است؛ وظیفه‌ی اینجا
 * فقط استخراج ورودی از درخواست و برگرداندن پاسخ است.
 */
import guardianshipService from '../services/guardianshipService.js';
import locationService from '../services/locationService.js';
import safeZoneService from '../services/safeZoneService.js';
import alertService from '../services/alertService.js';
import sosService from '../services/sosService.js';
import simulatorService from '../services/simulatorService.js';
import * as userRepository from '../repositories/userRepository.js';
import * as deviceRepository from '../repositories/deviceRepository.js';
import { asyncHandler } from '../middleware/error.js';

/* ─────────────────────────── سرپرستی ─────────────────────────── */

export const guardianship = {
  createInvite: asyncHandler(async (req, res) => {
    const result = await guardianshipService.createInvite(req.user.id, req.body.permissions);
    res.status(201).json(result);
  }),

  listInvites: asyncHandler(async (req, res) => {
    res.json({ invites: await guardianshipService.listInvites(req.user.id) });
  }),

  cancelInvite: asyncHandler(async (req, res) => {
    res.json(await guardianshipService.cancelInvite(req.params.id, req.user.id));
  }),

  redeem: asyncHandler(async (req, res) => {
    const result = await guardianshipService.redeemInvite(req.body.code, req.user.id);
    res.status(201).json(result);
  }),

  list: asyncHandler(async (req, res) => {
    res.json(await guardianshipService.listAll(req.user.id));
  }),

  updatePermissions: asyncHandler(async (req, res) => {
    const result = await guardianshipService.updatePermissions(
      req.params.id,
      req.user.id,
      req.body.permissions,
    );
    res.json(result);
  }),

  revoke: asyncHandler(async (req, res) => {
    res.json(await guardianshipService.revoke(req.params.id, req.user.id));
  }),
};

/* ─────────────────────────── موقعیت ─────────────────────────── */

export const location = {
  ping: asyncHandler(async (req, res) => {
    const result = await locationService.ingestPing(req.user.id, req.body);
    res.status(201).json(result);
  }),

  current: asyncHandler(async (req, res) => {
    const subjectId = req.query.userId ?? req.user.id;
    res.json(await locationService.getCurrentLocation(req.user.id, subjectId));
  }),

  ownStatus: asyncHandler(async (req, res) => {
    res.json(await locationService.getOwnStatus(req.user.id));
  }),

  watchList: asyncHandler(async (req, res) => {
    res.json({ watching: await locationService.getWatchList(req.user.id) });
  }),

  history: asyncHandler(async (req, res) => {
    const subjectId = req.query.userId ?? req.user.id;
    const { from, to, limit } = req.query;
    res.json(await locationService.getHistory(req.user.id, subjectId, { from, to, limit }));
  }),

  historyDays: asyncHandler(async (req, res) => {
    const subjectId = req.query.userId ?? req.user.id;
    res.json({ days: await locationService.getHistoryDays(req.user.id, subjectId) });
  }),

  deleteHistory: asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    res.json(await locationService.deleteHistory(req.user.id, { from, to }));
  }),

  setSharing: asyncHandler(async (req, res) => {
    const settings = await locationService.setLocationSharing(req.user.id, req.body.enabled);
    res.json({ settings });
  }),
};

/* ─────────────────────── محدوده‌های امن ─────────────────────── */

export const safeZone = {
  list: asyncHandler(async (req, res) => {
    res.json({ zones: await safeZoneService.list(req.user.id) });
  }),

  create: asyncHandler(async (req, res) => {
    res.status(201).json(await safeZoneService.create(req.user.id, req.body));
  }),

  update: asyncHandler(async (req, res) => {
    res.json(await safeZoneService.update(req.params.id, req.user.id, req.body));
  }),

  remove: asyncHandler(async (req, res) => {
    res.json(await safeZoneService.remove(req.params.id, req.user.id));
  }),

  preview: asyncHandler(async (req, res) => {
    res.json(await safeZoneService.preview(req.user.id, req.body));
  }),
};

/* ─────────────────────────── هشدارها ─────────────────────────── */

export const alert = {
  list: asyncHandler(async (req, res) => {
    const { types, unreadOnly, limit, before, userId } = req.query;
    res.json(
      await alertService.listAlerts(req.user.id, {
        types: types ? String(types).split(',').filter(Boolean) : undefined,
        unreadOnly,
        limit,
        before,
        subjectId: userId,
      }),
    );
  }),

  markRead: asyncHandler(async (req, res) => {
    res.json(await alertService.markRead(req.params.id, req.user.id));
  }),

  markAllRead: asyncHandler(async (req, res) => {
    res.json(await alertService.markAllRead(req.user.id));
  }),

  resolve: asyncHandler(async (req, res) => {
    res.json(await alertService.resolveAlert(req.params.id, req.user.id));
  }),
};

/* ─────────────────────────── SOS ─────────────────────────── */

export const sos = {
  trigger: asyncHandler(async (req, res) => {
    const result = await sosService.triggerSos(req.user.id, req.body ?? {});
    res.status(201).json(result);
  }),

  contacts: asyncHandler(async (req, res) => {
    res.json(await sosService.emergencyContacts(req.user.id));
  }),

  config: asyncHandler(async (_req, res) => {
    res.json(sosService.sosConfig());
  }),

  active: asyncHandler(async (req, res) => {
    const subjectId = req.query.userId ?? req.user.id;
    res.json({ alert: await sosService.activeSos(subjectId) });
  }),
};

/* ─────────────────────────── تنظیمات ─────────────────────────── */

export const settings = {
  get: asyncHandler(async (req, res) => {
    res.json({ settings: await userRepository.getSettings(req.user.id) });
  }),

  update: asyncHandler(async (req, res) => {
    res.json({ settings: await userRepository.updateSettings(req.user.id, req.body) });
  }),
};

/* ─────────────────────────── دستگاه‌ها ─────────────────────────── */

export const device = {
  register: asyncHandler(async (req, res) => {
    const registered = await deviceRepository.register({ userId: req.user.id, ...req.body });
    res.status(201).json({ device: registered });
  }),

  list: asyncHandler(async (req, res) => {
    res.json({ devices: await deviceRepository.listByUser(req.user.id) });
  }),

  remove: asyncHandler(async (req, res) => {
    const ok = await deviceRepository.remove(req.params.id, req.user.id);
    res.json({ ok });
  }),
};

/* ─────────────────────── شبیه‌ساز (حالت نمایش) ─────────────────────── */

export const simulator = {
  routes: asyncHandler(async (_req, res) => {
    res.json({ routes: simulatorService.listRoutes(), demoMode: true });
  }),

  start: asyncHandler(async (req, res) => {
    const result = await simulatorService.start(req.user.id, req.body);
    res.json(result);
  }),

  stop: asyncHandler(async (req, res) => {
    res.json(simulatorService.stop(req.user.id));
  }),

  status: asyncHandler(async (req, res) => {
    res.json(simulatorService.status(req.user.id));
  }),
};
