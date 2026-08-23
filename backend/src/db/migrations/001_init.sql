-- ═══════════════════════════════════════════════════════════════════════════
--  SafeStep / هم‌قدم — شمای اولیه‌ی دیتابیس
--  این فایل روی هر دو درایور (PostgreSQL شبکه‌ای و PGlite) یکسان اجرا می‌شود.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────── کاربران ─────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         VARCHAR(20)  NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  full_name     TEXT         NOT NULL,
  -- نقشِ پیش‌فرض حساب. یک کاربر می‌تواند همزمان در نقش دیگری هم قرار بگیرد
  -- (مثلاً کاربر اصلی که مراقب فرد دیگری هم هست)؛ دسترسی واقعی از
  -- جدول guardianships می‌آید، نه از این ستون.
  role          VARCHAR(16)  NOT NULL DEFAULT 'primary'
                CHECK (role IN ('primary', 'guardian')),
  locale        VARCHAR(8)   NOT NULL DEFAULT 'fa',
  avatar_color  VARCHAR(9)   NOT NULL DEFAULT '#2F6FED',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ─────────────────────── تنظیمات کاربر (یک‌به‌یک) ───────────────────────
CREATE TABLE IF NOT EXISTS user_settings (
  user_id                   UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- کلید اصلی استقلال کاربر: با false شدن، هیچ عضو خانواده‌ای موقعیت را نمی‌بیند
  location_sharing_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  long_stop_minutes         INTEGER NOT NULL DEFAULT 20 CHECK (long_stop_minutes BETWEEN 1 AND 240),
  long_stop_radius_m        INTEGER NOT NULL DEFAULT 40 CHECK (long_stop_radius_m BETWEEN 5 AND 500),
  -- انواع هشداری که کاربر اجازه‌ی تولیدشان را داده است
  alert_types               TEXT[]  NOT NULL DEFAULT ARRAY['sos','zone_exit','long_stop','gps_lost','low_battery'],
  theme                     VARCHAR(8)  NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  language                  VARCHAR(8)  NOT NULL DEFAULT 'fa',
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────────── دستگاه‌ها ─────────────────────────────
CREATE TABLE IF NOT EXISTS devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform      VARCHAR(16) NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  -- توکن FCM؛ اگر خالی باشد، نوتیفیکیشن از مسیر WebSocket تحویل داده می‌شود
  push_token    TEXT,
  device_name   TEXT,
  battery_level INTEGER CHECK (battery_level BETWEEN 0 AND 100),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, push_token)
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

-- ──────────────────── رابطه‌ی سرپرستی (کاربر اصلی ↔ عضو خانواده) ────────────────────
CREATE TABLE IF NOT EXISTS guardianships (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guardian_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- سطوح دسترسی: view_location | receive_alerts | emergency
  -- این آرایه در لایه‌ی سرویس واقعاً enforce می‌شود، نه فقط در رابط کاربری
  permissions      TEXT[] NOT NULL DEFAULT ARRAY['view_location','receive_alerts'],
  status           VARCHAR(16) NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'revoked')),
  nickname         TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ,
  UNIQUE (primary_user_id, guardian_user_id),
  -- کسی نمی‌تواند سرپرست خودش باشد
  CHECK (primary_user_id <> guardian_user_id)
);

CREATE INDEX IF NOT EXISTS idx_guardianships_primary  ON guardianships(primary_user_id, status);
CREATE INDEX IF NOT EXISTS idx_guardianships_guardian ON guardianships(guardian_user_id, status);

-- ───────────────────────────── کدهای دعوت ─────────────────────────────
CREATE TABLE IF NOT EXISTS invite_codes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- خودِ کد هرگز ذخیره نمی‌شود؛ فقط HMAC-SHA256 آن با کلید سرور
  code_hash        TEXT NOT NULL UNIQUE,
  -- سطح دسترسی‌ای که هنگام ساخت کد انتخاب شده و پس از مصرف اعمال می‌شود
  permissions      TEXT[] NOT NULL DEFAULT ARRAY['view_location','receive_alerts'],
  expires_at       TIMESTAMPTZ NOT NULL,
  used_at          TIMESTAMPTZ,
  used_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invite_codes_hash    ON invite_codes(code_hash);
CREATE INDEX IF NOT EXISTS idx_invite_codes_primary ON invite_codes(primary_user_id, created_at DESC);

-- ───────────────────────────── محدوده‌های امن ─────────────────────────────
CREATE TABLE IF NOT EXISTS safe_zones (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  center_lat DOUBLE PRECISION NOT NULL CHECK (center_lat BETWEEN -90  AND 90),
  center_lng DOUBLE PRECISION NOT NULL CHECK (center_lng BETWEEN -180 AND 180),
  -- کف ۵۰ متر: کمتر از آن با خطای معمول GPS شهری (۱۰ تا ۳۰ متر) هم‌مرتبه می‌شود
  -- و حتی با هیسترزیس هم هشدارهای کاذب تولید می‌کند
  radius_m   INTEGER NOT NULL CHECK (radius_m BETWEEN 50 AND 5000),
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  color      VARCHAR(9) NOT NULL DEFAULT '#2F6FED',
  icon       VARCHAR(32) NOT NULL DEFAULT 'home',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_safe_zones_user ON safe_zones(user_id, is_active);

-- ──────────────── وضعیت کاربر نسبت به هر محدوده (ماشین حالتِ هیسترزیس) ────────────────
-- بدون این جدول، هیسترزیس معنا ندارد: تصمیم‌گیری درباره‌ی «خروج» به
-- وضعیت قبلی نیاز دارد، نه فقط به فاصله‌ی فعلی.
CREATE TABLE IF NOT EXISTS zone_states (
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  zone_id            UUID NOT NULL REFERENCES safe_zones(id) ON DELETE CASCADE,
  state              VARCHAR(8) NOT NULL DEFAULT 'unknown'
                     CHECK (state IN ('inside', 'outside', 'unknown')),
  -- شمارنده‌ی debounce: چند پینگ متوالی وضعیتِ مخالفِ حالت فعلی را نشان داده‌اند
  consecutive_count  INTEGER NOT NULL DEFAULT 0,
  pending_state      VARCHAR(8) CHECK (pending_state IN ('inside', 'outside')),
  last_distance_m    DOUBLE PRECISION,
  last_transition_at TIMESTAMPTZ,
  last_alert_at      TIMESTAMPTZ,
  last_evaluated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, zone_id)
);

-- ───────────────────────────── پینگ‌های موقعیت ─────────────────────────────
CREATE TABLE IF NOT EXISTS location_pings (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat           DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90  AND 90),
  lng           DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m    REAL,
  speed_mps     REAL,
  heading_deg   REAL,
  battery_level INTEGER CHECK (battery_level BETWEEN 0 AND 100),
  -- صداقتِ «حالت نمایش» تا سطح دیتابیس: هر پینگی که شبیه‌ساز تولید کرده
  -- برای همیشه به همین عنوان قابل تشخیص است و در رابط کاربری برچسب می‌خورد
  is_simulated  BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_at   TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- پرتکرارترین کوئری‌های سیستم: «آخرین موقعیت» و «مسیر یک بازه‌ی زمانی»
CREATE INDEX IF NOT EXISTS idx_pings_user_time ON location_pings(user_id, recorded_at DESC);

-- ───────────────────────────── هشدارها ─────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- کاربری که هشدار درباره‌ی اوست (همیشه کاربر اصلی)
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(32) NOT NULL
              CHECK (type IN ('sos','zone_exit','zone_enter','long_stop','gps_lost','low_battery')),
  severity    VARCHAR(16) NOT NULL DEFAULT 'warning'
              CHECK (severity IN ('info','warning','critical')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  zone_id     UUID REFERENCES safe_zones(id) ON DELETE SET NULL,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_user_time ON alerts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_type      ON alerts(user_id, type, created_at DESC);

-- وضعیت خوانده‌شدن هر هشدار، به تفکیک عضو خانواده
CREATE TABLE IF NOT EXISTS alert_reads (
  alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (alert_id, user_id)
);

-- ───────────────────────── توکن‌های تازه‌سازی (نشست‌ها) ─────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- شناسه‌ی یکتای داخل توکن (jti) برای ابطال تک‌نشست
  jti        UUID NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
