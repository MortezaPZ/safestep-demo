/**
 * تبدیل ردیف‌های دیتابیس (snake_case) به اشیای دامنه (camelCase).
 *
 * عمداً به‌جای یک تبدیل‌گر عمومی، برای هر موجودیت یک نگاشت صریح نوشته شده است:
 * این نگاشت‌ها همزمان نقش «مستندِ شکل داده‌ای که به کلاینت می‌رود» را هم دارند
 * و جلوی نشت تصادفی ستون‌های حساس (مثل password_hash) را می‌گیرند.
 */

/** تبدیل امن مقدار عددی — Postgres گاهی DOUBLE PRECISION را رشته برمی‌گرداند. */
const n = (value) => (value === null || value === undefined ? null : Number(value));

/** تبدیل تاریخ به ISO؛ کلاینت خودش تاریخ شمسی و «چند دقیقه پیش» را می‌سازد. */
const d = (value) => (value ? new Date(value).toISOString() : null);

export function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    phone: row.phone,
    fullName: row.full_name,
    role: row.role,
    locale: row.locale,
    avatarColor: row.avatar_color,
    createdAt: d(row.created_at),
  };
}

export function mapSettings(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    locationSharingEnabled: row.location_sharing_enabled,
    longStopMinutes: row.long_stop_minutes,
    longStopRadiusM: row.long_stop_radius_m,
    alertTypes: row.alert_types ?? [],
    theme: row.theme,
    language: row.language,
    updatedAt: d(row.updated_at),
  };
}

export function mapDevice(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    deviceName: row.device_name,
    // خودِ توکن push هرگز به کلاینت برنمی‌گردد؛ فقط اینکه ثبت شده یا نه
    hasPushToken: Boolean(row.push_token),
    batteryLevel: row.battery_level,
    lastSeenAt: d(row.last_seen_at),
    createdAt: d(row.created_at),
  };
}

export function mapGuardianship(row) {
  if (!row) return null;
  return {
    id: row.id,
    primaryUserId: row.primary_user_id,
    guardianUserId: row.guardian_user_id,
    permissions: row.permissions ?? [],
    status: row.status,
    nickname: row.nickname,
    createdAt: d(row.created_at),
    revokedAt: d(row.revoked_at),
    // این فیلدها فقط وقتی پر می‌شوند که کوئری JOIN زده باشد
    ...(row.primary_name !== undefined
      ? {
          primaryUser: {
            id: row.primary_user_id,
            fullName: row.primary_name,
            phone: row.primary_phone,
            avatarColor: row.primary_avatar_color,
          },
        }
      : {}),
    ...(row.guardian_name !== undefined
      ? {
          guardianUser: {
            id: row.guardian_user_id,
            fullName: row.guardian_name,
            phone: row.guardian_phone,
            avatarColor: row.guardian_avatar_color,
          },
        }
      : {}),
  };
}

export function mapInvite(row) {
  if (!row) return null;
  return {
    id: row.id,
    primaryUserId: row.primary_user_id,
    permissions: row.permissions ?? [],
    expiresAt: d(row.expires_at),
    usedAt: d(row.used_at),
    usedByUserId: row.used_by_user_id,
    createdAt: d(row.created_at),
    isUsed: Boolean(row.used_at),
    isExpired: row.expires_at ? new Date(row.expires_at).getTime() < Date.now() : false,
    // توجه: code_hash عمداً نگاشت نمی‌شود
  };
}

export function mapSafeZone(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    centerLat: n(row.center_lat),
    centerLng: n(row.center_lng),
    radiusM: row.radius_m,
    isActive: row.is_active,
    color: row.color,
    icon: row.icon,
    createdAt: d(row.created_at),
    updatedAt: d(row.updated_at),
  };
}

export function mapZoneState(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    zoneId: row.zone_id,
    state: row.state,
    consecutiveCount: row.consecutive_count,
    pendingState: row.pending_state,
    lastDistanceM: n(row.last_distance_m),
    lastTransitionAt: d(row.last_transition_at),
    lastAlertAt: d(row.last_alert_at),
    lastEvaluatedAt: d(row.last_evaluated_at),
    ...(row.zone_name !== undefined
      ? { zoneName: row.zone_name, radiusM: row.radius_m, isActive: row.is_active }
      : {}),
  };
}

export function mapPing(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    lat: n(row.lat),
    lng: n(row.lng),
    accuracyM: n(row.accuracy_m),
    speedMps: n(row.speed_mps),
    headingDeg: n(row.heading_deg),
    batteryLevel: row.battery_level,
    isSimulated: row.is_simulated,
    recordedAt: d(row.recorded_at),
  };
}

export function mapAlert(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    severity: row.severity,
    title: row.title,
    body: row.body,
    lat: n(row.lat),
    lng: n(row.lng),
    zoneId: row.zone_id,
    metadata: row.metadata ?? {},
    createdAt: d(row.created_at),
    resolvedAt: d(row.resolved_at),
    resolvedBy: row.resolved_by,
    ...(row.is_read !== undefined ? { isRead: Boolean(row.is_read) } : {}),
    ...(row.subject_name !== undefined
      ? {
          subject: {
            id: row.user_id,
            fullName: row.subject_name,
            avatarColor: row.subject_avatar_color,
          },
        }
      : {}),
    ...(row.zone_name !== undefined && row.zone_name !== null ? { zoneName: row.zone_name } : {}),
  };
}
