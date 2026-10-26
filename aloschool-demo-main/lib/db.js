const fs = require("fs");
const path = require("path");

// Vercel-এ প্রজেক্ট ফোল্ডার read-only, তাই সেখানে শুধু /tmp-এ লেখা যায় (অস্থায়ী)।
const DATA_DIR = process.env.VERCEL
  ? path.join(require("os").tmpdir(), "data")
  : path.join(__dirname, "..", "data");
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.error("[db] data ফোল্ডার বানানো যায়নি:", e.message);
}

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useUpstash = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

// Neon / যেকোনো PostgreSQL: DATABASE_URL সেট থাকলে (এবং Upstash সেট না থাকলে) সব ডেটা
// একটি `kv` টেবিলে (key TEXT PRIMARY KEY, value JSONB) থাকে। অ্যাপের বাকি অংশ আগের মতোই
// get/set/keys ব্যবহার করে — কোড বদলাতে হয় না। অগ্রাধিকার: Upstash → PostgreSQL → লোকাল ফাইল।
const DATABASE_URL = process.env.DATABASE_URL;
const usePostgres = Boolean(DATABASE_URL) && !useUpstash;

let _pool = null;
let _ready = null;
function pgPool() {
  if (_pool) return _pool;
  let Pool;
  try {
    ({ Pool } = require("pg"));
  } catch (e) {
    throw new Error("DATABASE_URL সেট আছে কিন্তু `pg` প্যাকেজ ইনস্টল নেই — `npm install` চালান।");
  }
  const cfg = { connectionString: DATABASE_URL, max: process.env.VERCEL ? 3 : 8 };
  // Neon-এর URL-এ সাধারণত ?sslmode=require থাকে; না থাকলে লোকাল ছাড়া সব জায়গায় SSL চালু।
  if (!/sslmode=/.test(DATABASE_URL) && !/localhost|127\.0\.0\.1/.test(DATABASE_URL)) cfg.ssl = true;
  _pool = new Pool(cfg);
  _pool.on("error", (e) => console.error("[db] postgres pool error:", e.message));
  return _pool;
}
async function pgQuery(text, params) {
  const pool = pgPool();
  if (!_ready) {
    _ready = pool
      .query("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value JSONB)")
      .catch((e) => {
        _ready = null;
        throw e;
      });
  }
  await _ready;
  return pool.query(text, params);
}

function fileFor(key) {
  const safe = key.replace(/[^a-zA-Z0-9_:-]/g, "_");
  return path.join(DATA_DIR, `${safe}.json`);
}

async function get(key) {
  if (usePostgres) {
    const r = await pgQuery("SELECT value FROM kv WHERE key = $1", [key]);
    return r.rows.length ? r.rows[0].value : null;
  }
  if (useUpstash) {
    const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    const data = await res.json();
    if (!data.result) return null;
    try {
      return JSON.parse(data.result);
    } catch {
      return null;
    }
  } else {
    const f = fileFor(key);
    if (!fs.existsSync(f)) return null;
    try {
      return JSON.parse(fs.readFileSync(f, "utf-8"));
    } catch {
      return null;
    }
  }
}

async function set(key, value) {
  const json = JSON.stringify(value === undefined ? null : value);
  if (usePostgres) {
    await pgQuery(
      "INSERT INTO kv (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [key, json]
    );
    return;
  }
  if (useUpstash) {
    await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "text/plain",
      },
      body: json,
    });
  } else {
    fs.writeFileSync(fileFor(key), json, "utf-8");
  }
}

async function keys(prefix) {
  if (usePostgres) {
    const like = String(prefix).replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    const r = await pgQuery("SELECT key FROM kv WHERE key LIKE $1 ORDER BY key", [like]);
    return r.rows.map((x) => x.key);
  }
  if (useUpstash) {
    const res = await fetch(`${UPSTASH_URL}/keys/${encodeURIComponent(prefix + "*")}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    const data = await res.json();
    return data.result || [];
  } else {
    if (!fs.existsSync(DATA_DIR)) return [];
    return fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, "").replace(/_/g, ":"))
      .filter((k) => k.startsWith(prefix));
  }
}

// =====================================================================
// হিফজ দৈনিক সবক রেকর্ড — `hifz_daily_records` "টেবিল"
// =====================================================================
// এই অ্যাপের ডেটাবেস SQL নয় — এটা একটা key-value স্টোর (লোকাল JSON ফাইল,
// অথবা Upstash Redis)। তাই `hifz_daily_records` এখানে একটি টেবিলের মতো
// আচরণ করে: নির্দিষ্ট কলাম, ভ্যালিডেশন, এবং (student_id, entry_date) জোড়ায়
// ইউনিক রেকর্ড (upsert)। প্রতিটি তালিবুল ইলমর রেকর্ড একটিই key-তে থাকে:
//   hifz:records:<student_id>  ->  [ { ...row }, ... ]
// (key-তে underscore ইচ্ছাকৃতভাবে নেই — লোকাল ফাইল মোডে keys() underscore-কে
// colon-এ বদলে ফেলে, তাই `hifz:` ব্যবহার করা নিরাপদ।)
//
// ভবিষ্যতে PostgreSQL/SQLite-এ গেলে নিচের HIFZ_SQL_MIGRATION হুবহু চালানো যাবে
// (migrations/001_hifz_daily_records.sql ফাইলেও একই কোড আছে)।

const HIFZ_RATINGS = ["মুমতাজ", "জায়্যিদ জিদ্দান", "জায়্যিদ", "মাকবুল"];

const HIFZ_SQL_MIGRATION = {
  postgres: `
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
`.trim(),
  sqlite: `
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
`.trim(),
};

// বাংলা অঙ্ক (০-৯) -> ইংরেজি অঙ্ক, যাতে উস্তাদ বাংলা কিবোর্ডে "৫" লিখলেও ঠিকমতো কাজ করে।
function bnToEnDigits(v) {
  return String(v == null ? "" : v).replace(/[\u09E6-\u09EF]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
}

const HIFZ_TEXT_MAX = 200;
const HIFZ_COMMENT_MAX = 500;

// একটি রেকর্ড যাচাই + স্বাভাবিক করে। ফেরত দেয় { ok: true, value } অথবা { ok: false, error }.
function validateHifzRecord(input) {
  const r = input || {};
  const student_id = String(r.student_id || "").trim();
  const entry_date = bnToEnDigits(r.entry_date || "").trim();
  if (!student_id) return { ok: false, error: "তালিবুল ইলম নির্ধারিত নয়" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry_date) || Number.isNaN(Date.parse(entry_date))) {
    return { ok: false, error: "তারিখ সঠিক নয়" };
  }
  const para_no = parseInt(bnToEnDigits(r.para_no), 10);
  if (!Number.isInteger(para_no) || para_no < 1 || para_no > 30) {
    return { ok: false, error: "পারা নম্বর ১ থেকে ৩০ এর মধ্যে হতে হবে" };
  }
  const rating = String(r.rating || "").trim();
  if (rating && !HIFZ_RATINGS.includes(rating)) return { ok: false, error: "মান (রেটিং) সঠিক নয়" };
  const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
  return {
    ok: true,
    value: {
      student_id,
      entry_date,
      para_no,
      sabaq: clip(r.sabaq, HIFZ_TEXT_MAX),
      sabaq_dawr: clip(r.sabaq_dawr, HIFZ_TEXT_MAX),
      dawr: clip(r.dawr, HIFZ_TEXT_MAX),
      rating,
      comments: clip(r.comments, HIFZ_COMMENT_MAX),
      class_slug: clip(r.class_slug, 120),
      ustad_id: clip(r.ustad_id, 60),
      ustad_name: clip(r.ustad_name, 120),
    },
  };
}

const hifzDailyRecords = {
  name: "hifz_daily_records",
  ratings: HIFZ_RATINGS,
  key: (studentId) => `hifz:records:${String(studentId).trim()}`,
  validate: validateHifzRecord,

  // তালিবুল ইলমর সব রেকর্ড, তারিখ অনুযায়ী নতুন আগে।
  async listByStudent(studentId) {
    const rows = (await get(this.key(studentId))) || [];
    return rows.slice().sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  },

  async getByDate(studentId, entryDate) {
    const rows = (await get(this.key(studentId))) || [];
    return rows.find((r) => r.entry_date === entryDate) || null;
  },

  // (student_id, entry_date) ইউনিক — থাকলে আপডেট, না থাকলে নতুন।
  async upsert(input) {
    const v = validateHifzRecord(input);
    if (!v.ok) throw new Error(v.error);
    const rec = v.value;
    const rows = (await get(this.key(rec.student_id))) || [];
    const idx = rows.findIndex((r) => r.entry_date === rec.entry_date);
    const now = Date.now();
    if (idx >= 0) rows[idx] = { ...rows[idx], ...rec, created_at: rows[idx].created_at || now, updated_at: now };
    else rows.push({ ...rec, created_at: now, updated_at: now });
    await set(this.key(rec.student_id), rows);
    return idx >= 0 ? rows[idx] : rows[rows.length - 1];
  },

  async remove(studentId, entryDate) {
    const rows = (await get(this.key(studentId))) || [];
    const next = rows.filter((r) => r.entry_date !== entryDate);
    if (next.length !== rows.length) await set(this.key(studentId), next);
    return rows.length - next.length;
  },
};

module.exports = { get, set, keys, useUpstash, usePostgres, hifzDailyRecords, HIFZ_RATINGS, HIFZ_SQL_MIGRATION, bnToEnDigits };
