-- Base schema as it exists in production (for local dev only; prod already has this).
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  ip TEXT, ua TEXT, source TEXT, country TEXT
);
CREATE INDEX IF NOT EXISTS idx_subscribers_created ON subscribers(created_at DESC);
CREATE TABLE IF NOT EXISTS rate_limits (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);
