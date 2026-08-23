/** ثابت‌های مشترک دامنه — تنها منبع حقیقت برای مقادیر مجاز. */

/** سطوح دسترسی که یک کاربر اصلی می‌تواند به عضو خانواده بدهد. */
export const PERMISSIONS = Object.freeze({
  VIEW_LOCATION: 'view_location',
  RECEIVE_ALERTS: 'receive_alerts',
  EMERGENCY: 'emergency',
});
export const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

/** برچسب فارسی سطوح دسترسی — برای نمایش در رابط کاربری. */
export const PERMISSION_LABELS = Object.freeze({
  [PERMISSIONS.VIEW_LOCATION]: 'مشاهده‌ی موقعیت',
  [PERMISSIONS.RECEIVE_ALERTS]: 'دریافت هشدار',
  [PERMISSIONS.EMERGENCY]: 'دسترسی اضطراری',
});

export const ROLES = Object.freeze({ PRIMARY: 'primary', GUARDIAN: 'guardian' });

export const GUARDIANSHIP_STATUS = Object.freeze({ ACTIVE: 'active', REVOKED: 'revoked' });

/** انواع هشدار. هر نوع یک سطح اهمیت ثابت دارد. */
export const ALERT_TYPES = Object.freeze({
  SOS: 'sos',
  ZONE_EXIT: 'zone_exit',
  ZONE_ENTER: 'zone_enter',
  LONG_STOP: 'long_stop',
  GPS_LOST: 'gps_lost',
  LOW_BATTERY: 'low_battery',
});
export const ALL_ALERT_TYPES = Object.freeze(Object.values(ALERT_TYPES));

export const SEVERITY = Object.freeze({ INFO: 'info', WARNING: 'warning', CRITICAL: 'critical' });

/**
 * نگاشت نوع هشدار به سطح اهمیت.
 * قاعده‌ی طراحی: قرمز (critical) فقط و فقط برای SOS.
 */
export const ALERT_SEVERITY = Object.freeze({
  [ALERT_TYPES.SOS]: SEVERITY.CRITICAL,
  [ALERT_TYPES.ZONE_EXIT]: SEVERITY.WARNING,
  [ALERT_TYPES.LONG_STOP]: SEVERITY.WARNING,
  [ALERT_TYPES.GPS_LOST]: SEVERITY.WARNING,
  [ALERT_TYPES.LOW_BATTERY]: SEVERITY.INFO,
  [ALERT_TYPES.ZONE_ENTER]: SEVERITY.INFO,
});

/** کدام سطح دسترسی برای دریافت هر نوع هشدار لازم است. */
export const ALERT_REQUIRED_PERMISSION = Object.freeze({
  [ALERT_TYPES.SOS]: PERMISSIONS.EMERGENCY,
  [ALERT_TYPES.ZONE_EXIT]: PERMISSIONS.RECEIVE_ALERTS,
  [ALERT_TYPES.ZONE_ENTER]: PERMISSIONS.RECEIVE_ALERTS,
  [ALERT_TYPES.LONG_STOP]: PERMISSIONS.RECEIVE_ALERTS,
  [ALERT_TYPES.GPS_LOST]: PERMISSIONS.RECEIVE_ALERTS,
  [ALERT_TYPES.LOW_BATTERY]: PERMISSIONS.RECEIVE_ALERTS,
});

/** وضعیت کاربر نسبت به یک محدوده‌ی امن. */
export const ZONE_STATE = Object.freeze({ INSIDE: 'inside', OUTSIDE: 'outside', UNKNOWN: 'unknown' });

/** رویدادهای WebSocket — نام‌ها بین بک‌اند، وب و موبایل مشترک است. */
export const WS_EVENTS = Object.freeze({
  LOCATION_UPDATE: 'location:update',
  ALERT_NEW: 'alert:new',
  ALERT_READ: 'alert:read',
  SHARING_CHANGED: 'sharing:changed',
  ZONE_STATE: 'zone:state',
  PRESENCE: 'presence',
  SIMULATOR_STATUS: 'simulator:status',
});

export const PLATFORMS = Object.freeze(['android', 'ios', 'web']);
