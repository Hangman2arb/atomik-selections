/* Shared helpers for Pages Functions */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
export const RATE_WINDOW_SECS = 60 * 60;
export const RATE_MAX_HITS = 5;

export const now = () => Math.floor(Date.now() / 1000);

export function corsHeaders(origin, env) {
  let allowed = [];
  try { allowed = JSON.parse(env.ALLOWED_ORIGINS || "[]"); } catch {}
  const allowOrigin = allowed.includes(origin) ? origin : (allowed[0] || "*");
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

/** Error envelope used by the admin API: `{error:"<code>", message?}`. */
export function fail(code, status, message) {
  return json(message ? { error: code, message } : { error: code }, status);
}

export function clientIp(request) {
  return (request.headers.get("CF-Connecting-IP") || "").slice(0, 64);
}

/**
 * Parse a JSON body defensively. Requires `Content-Type: application/json`
 * (browsers cannot send that cross-site without a CORS preflight → CSRF guard)
 * and caps the size. Returns { body } or { error: Response }.
 */
export async function readJson(request, { maxBytes = 256 * 1024 } = {}) {
  const ct = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!ct.startsWith("application/json")) {
    return { error: fail("bad_content_type", 415, "Content-Type must be application/json") };
  }
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > maxBytes) return { error: fail("payload_too_large", 413) };
  let text;
  try { text = await request.text(); } catch { return { error: fail("bad_json", 400) }; }
  if (text.length > maxBytes) return { error: fail("payload_too_large", 413) };
  try {
    const body = text.length ? JSON.parse(text) : {};
    if (body === null || typeof body !== "object" || Array.isArray(body)) return { error: fail("bad_json", 400) };
    return { body };
  } catch {
    return { error: fail("bad_json", 400) };
  }
}

/**
 * Fixed-window rate limiter on the `rate_limits` table. `key` is the PK
 * (a bare IP for the public subscribe endpoint, `login:<ip>` for admin login).
 * Returns true when the request is allowed.
 */
export async function rateLimit(env, key, { window = RATE_WINDOW_SECS, max = RATE_MAX_HITS } = {}) {
  if (!key || !env.DB) return true;
  const ts = now();
  const winStart = ts - window;

  const row = await env.DB
    .prepare("SELECT count, window_start FROM rate_limits WHERE ip = ?")
    .bind(key).first();

  if (!row || row.window_start < winStart) {
    await env.DB
      .prepare("INSERT OR REPLACE INTO rate_limits (ip, count, window_start) VALUES (?, 1, ?)")
      .bind(key, ts).run();
    return true;
  }
  if (row.count >= max) return false;
  await env.DB
    .prepare("UPDATE rate_limits SET count = count + 1 WHERE ip = ?")
    .bind(key).run();
  return true;
}

/**
 * Read-only twin of rateLimit(): true when the key is still under `max` in the
 * current window. Nothing is written, so callers can "peek" before an
 * expensive check and only "hit" (rateLimit) on the failure branch — the
 * counter then measures failed attempts, not traffic.
 */
export async function rateLimitCheck(env, key, { window = RATE_WINDOW_SECS, max = RATE_MAX_HITS } = {}) {
  if (!key || !env.DB) return true;
  const row = await env.DB
    .prepare("SELECT count, window_start FROM rate_limits WHERE ip = ?")
    .bind(key).first();
  if (!row || row.window_start < now() - window) return true;
  return row.count < max;
}

export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true; // optional
  if (!token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", body: form,
  });
  const data = await r.json().catch(() => ({}));
  return data.success === true;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/** Append a row to admin_audit. Never throws — auditing must not break the request. */
export async function audit(env, { admin, action, target = null, ip = "" }) {
  try {
    await env.DB.prepare(
      "INSERT INTO admin_audit (admin_email, action, target, ip) VALUES (?, ?, ?, ?)"
    ).bind(admin?.email || null, action, target == null ? null : String(target).slice(0, 300), ip || null).run();
  } catch (e) {
    console.error("audit failed:", e?.message || e);
  }
}

/**
 * Parse a path segment such as `/leads/:id` into a positive integer. Strict on
 * purpose: leading zeros, signs, decimals, exponents and anything that would
 * survive `parseInt` are rejected → null → the caller answers 404.
 */
export function pathId(v) {
  return /^[1-9]\d{0,15}$/.test(String(v ?? "")) ? Number(v) : null;
}

/** `jane@example.com` → `j***@example.com`. Used so audit rows keep no full PII. */
export function maskEmail(email) {
  const s = String(email || "");
  const at = s.indexOf("@");
  if (at <= 0) return s ? s[0] + "***" : "";
  return `${s[0]}***@${s.slice(at + 1)}`;
}

/** Audit `target` for lead actions: `lead#7 j***@example.com` (id + masked address, never the full email). */
export function leadTarget(row) {
  return `lead#${row.id} ${maskEmail(row.email)}`;
}

/* ---------- CSV ---------- */

export function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  // Prefix formula-looking cells so spreadsheets do not execute them.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvResponse(lines, filename) {
  return new Response(lines.join("\r\n") + "\r\n", {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export function toIso(unixSecs) {
  return new Date((Number(unixSecs) || 0) * 1000).toISOString();
}

/** Small typed getters for query strings / bodies. */
export const pick = {
  str(v, max = 200) { return typeof v === "string" ? v.trim().slice(0, max) : ""; },
  int(v, def, min, max) {
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  },
  bool(v, def) {
    if (typeof v === "boolean") return v;
    if (v === 1 || v === "1" || v === "true") return true;
    if (v === 0 || v === "0" || v === "false") return false;
    return def;
  },
  /** "YYYY-MM-DD" → unix seconds at UTC midnight (or null). */
  day(v) {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const t = Date.parse(v + "T00:00:00Z");
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  },
};
