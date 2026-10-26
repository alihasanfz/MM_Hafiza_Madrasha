-- হিফজ দৈনিক সবক রেকর্ড — SQL migration (ঐচ্ছিক)
-- বর্তমান অ্যাপ key-value স্টোর ব্যবহার করে (lib/db.js দেখুন); এই ফাইল শুধু ভবিষ্যতে SQL-এ গেলে কাজে লাগবে।

-- ===== PostgreSQL =====
CREATE TABLE IF NOT EXISTS hifz_daily_records (
  id          BIGSERIAL PRIMARY KEY,
  student_id  TEXT        NOT NULL,
  entry_date  DATE        NOT NULL,
  para_no     SMALLINT    NOT NULL CHECK (para_no BETWEEN 1 AND 30),
  sabaq       TEXT        NOT NULL DEFAULT '',   -- নতুন সবক
  sabaq_dawr  TEXT        NOT NULL DEFAULT '',   -- সবক দোরা
  dawr        TEXT        NOT NULL DEFAULT '',   -- আম দোরা
  rating      TEXT        NOT NULL DEFAULT ''
              CHECK (rating IN ('', 'মুমতাজ', 'জায়্যিদ জিদ্দান', 'জায়্যিদ', 'মাকবুল')),
  comments    TEXT        NOT NULL DEFAULT '',
  class_slug  TEXT        NOT NULL DEFAULT '',
  ustad_id    TEXT        NOT NULL DEFAULT '',
  ustad_name  TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, entry_date)
);
CREATE INDEX IF NOT EXISTS idx_hifz_records_date  ON hifz_daily_records (entry_date);
CREATE INDEX IF NOT EXISTS idx_hifz_records_class ON hifz_daily_records (class_slug, entry_date);

-- ===== SQLite =====
CREATE TABLE IF NOT EXISTS hifz_daily_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  TEXT    NOT NULL,
  entry_date  TEXT    NOT NULL,                  -- YYYY-MM-DD
  para_no     INTEGER NOT NULL CHECK (para_no BETWEEN 1 AND 30),
  sabaq       TEXT    NOT NULL DEFAULT '',
  sabaq_dawr  TEXT    NOT NULL DEFAULT '',
  dawr        TEXT    NOT NULL DEFAULT '',
  rating      TEXT    NOT NULL DEFAULT ''
              CHECK (rating IN ('', 'মুমতাজ', 'জায়্যিদ জিদ্দান', 'জায়্যিদ', 'মাকবুল')),
  comments    TEXT    NOT NULL DEFAULT '',
  class_slug  TEXT    NOT NULL DEFAULT '',
  ustad_id    TEXT    NOT NULL DEFAULT '',
  ustad_name  TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, entry_date)
);
CREATE INDEX IF NOT EXISTS idx_hifz_records_date  ON hifz_daily_records (entry_date);
CREATE INDEX IF NOT EXISTS idx_hifz_records_class ON hifz_daily_records (class_slug, entry_date);
