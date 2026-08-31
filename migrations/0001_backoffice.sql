-- 0001 · Backoffice + email pipeline. STRICTLY ADDITIVE — safe to apply on the live DB
-- while the old code is still running (old inserts name their columns explicitly).
ALTER TABLE subscribers ADD COLUMN discount_code TEXT;
ALTER TABLE subscribers ADD COLUMN welcome_sent_at INTEGER;
ALTER TABLE subscribers ADD COLUMN welcome_status TEXT;      -- 'sent' | 'failed' | 'skipped' | NULL (never attempted)
ALTER TABLE subscribers ADD COLUMN notes TEXT;
ALTER TABLE subscribers ADD COLUMN unsubscribed_at INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_code ON subscribers(discount_code);
CREATE INDEX IF NOT EXISTS idx_subscribers_country ON subscribers(country);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT,
  pass_hash TEXT NOT NULL,                    -- base64 PBKDF2-SHA256 (32 bytes)
  pass_salt TEXT NOT NULL,                    -- base64 16 random bytes
  iterations INTEGER NOT NULL DEFAULT 12000,  -- kept low on purpose: Pages Functions CPU budget
  pass_version INTEGER NOT NULL DEFAULT 1,    -- bumped on password change → old sessions die
  must_change INTEGER NOT NULL DEFAULT 1,     -- force password change on first login
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_login_at INTEGER,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscriber_id INTEGER,
  to_email TEXT NOT NULL,
  kind TEXT NOT NULL,                         -- 'welcome' | 'resend' | 'test'
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_id TEXT,
  status TEXT NOT NULL,                       -- 'sent' | 'failed' | 'skipped'
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_email_log_sub ON email_log(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_email TEXT,
  action TEXT NOT NULL,                       -- 'login' | 'login_failed' | 'logout' | 'lead_delete' | 'lead_note' | 'resend_welcome' | 'settings_update' | 'admin_create' | 'admin_delete' | 'password_change' | 'email_test'
  target TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC);
