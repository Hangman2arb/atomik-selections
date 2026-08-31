/* Email module: settings (DB over defaults), template rendering, Resend
   delivery, email_log bookkeeping and discount-code generation. */

import { EMAIL_RE, escapeHtml, now, pick } from "./_lib.js";

export const SETTINGS_KEYS = Object.freeze([
  "welcome_enabled", "welcome_subject", "welcome_html", "welcome_text",
  "from_name", "from_email", "reply_to",
  "discount_enabled", "discount_label", "discount_prefix",
]);

export const TEMPLATE_VARS = Object.freeze(["{{email}}", "{{code}}", "{{discount}}", "{{site_url}}"]);

export const LIMITS = Object.freeze({
  welcome_subject: 300, welcome_html: 200_000, welcome_text: 50_000,
  from_name: 100, from_email: 254, reply_to: 254, discount_label: 120, discount_prefix: 6,
});

export const DEFAULT_SITE_URL = "https://atomikselections.com";

export function siteUrl(env) {
  return String(env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
}

export function isEmailConfigured(env) {
  return Boolean(env.RESEND_API_KEY);
}

/** Extract the address from `Name <addr>` or a bare address. */
function addressOf(s) {
  const m = /<([^>]+)>/.exec(String(s || ""));
  const addr = (m ? m[1] : String(s || "")).trim().toLowerCase();
  return EMAIL_RE.test(addr) ? addr : "";
}

export function defaults(env) {
  return {
    welcome_enabled: true,
    discount_enabled: true,
    discount_label: "launch discount",
    discount_prefix: "ATK",
    from_name: "Atomik Selections",
    from_email: addressOf(env.FROM_EMAIL) || "hello@atomikselections.com",
    reply_to: "atomikselections@gmail.com",
    welcome_subject: "You're on the list — your Atomik launch code inside ⚛",
    welcome_html: DEFAULT_HTML,
    welcome_text: DEFAULT_TEXT,
  };
}

/** Validate a partial settings object. → { value, errors } (value only has the valid keys). */
export function validateSettings(input) {
  const value = {};
  const errors = {};
  const src = input && typeof input === "object" ? input : {};

  for (const k of ["welcome_enabled", "discount_enabled"]) {
    if (k in src) {
      const b = pick.bool(src[k], null);
      if (b === null) errors[k] = "must be a boolean"; else value[k] = b;
    }
  }
  for (const k of ["welcome_subject", "welcome_html", "welcome_text", "from_name", "discount_label"]) {
    if (k in src) {
      if (typeof src[k] !== "string") { errors[k] = "must be a string"; continue; }
      if (src[k].length > LIMITS[k]) { errors[k] = `max ${LIMITS[k]} characters`; continue; }
      value[k] = k === "welcome_html" || k === "welcome_text" ? src[k] : src[k].trim();
      if (!value[k] && k !== "discount_label") errors[k] = "must not be empty";
    }
  }
  if ("from_email" in src) {
    const a = addressOf(src.from_email);
    if (!a || String(src.from_email).length > LIMITS.from_email) errors.from_email = "must be a valid email address";
    else value.from_email = a;
  }
  if ("reply_to" in src) {
    const raw = String(src.reply_to ?? "").trim();
    if (raw === "") value.reply_to = "";
    else {
      const a = addressOf(raw);
      if (!a || raw.length > LIMITS.reply_to) errors.reply_to = "must be a valid email address or empty";
      else value.reply_to = a;
    }
  }
  if ("discount_prefix" in src) {
    const p = String(src.discount_prefix ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{2,6}$/.test(p)) errors.discount_prefix = "2–6 letters or digits";
    else value.discount_prefix = p;
  }
  return { value, errors };
}

/** DB settings merged over defaults. Whitelisted keys only — `session_secret`
 *  lives in the same table and must never leave the server. */
export async function getSettings(env) {
  const base = defaults(env);
  if (!env.DB) return base;
  const marks = SETTINGS_KEYS.map(() => "?").join(",");
  const { results } = await env.DB
    .prepare(`SELECT key, value FROM settings WHERE key IN (${marks})`)
    .bind(...SETTINGS_KEYS).all();
  const stored = {};
  for (const r of results || []) {
    try { stored[r.key] = JSON.parse(r.value); } catch { /* ignore corrupt value */ }
  }
  const { value } = validateSettings(stored);
  return { ...base, ...value };
}

export async function saveSettings(env, patch, by) {
  const keys = Object.keys(patch).filter((k) => SETTINGS_KEYS.includes(k));
  if (!keys.length) return;
  const ts = now();
  const stmt = env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by"
  );
  await env.DB.batch(keys.map((k) => stmt.bind(k, JSON.stringify(patch[k]), ts, by || null)));
}

/* ---------- templates ---------- */

export function renderTemplate(str, vars, { html = false } = {}) {
  return String(str ?? "").replace(/\{\{\s*(email|code|discount|site_url)\s*\}\}/g, (_, k) => {
    const v = vars[k] == null ? "" : String(vars[k]);
    return html ? escapeHtml(v) : v;
  });
}

export function templateVars(env, settings, { email = "", code = "" } = {}) {
  return {
    email,
    code: code || "—",
    discount: settings.discount_label || "launch discount",
    site_url: siteUrl(env),
  };
}

export function renderEmail(env, settings, vars) {
  return {
    subject: renderTemplate(settings.welcome_subject, vars),
    html: renderTemplate(settings.welcome_html, vars, { html: true }),
    text: renderTemplate(settings.welcome_text, vars),
  };
}

/* ---------- discount codes ---------- */

// Crockford base32 (no I/L/O/U) minus the digits 0 and 1 → 30 unambiguous symbols.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateDiscountCode(prefix = "ATK") {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) {
    if (b >= 240) continue; // 240 = 8 * 30 → uniform (no modulo bias)
    s += CODE_ALPHABET[b % CODE_ALPHABET.length];
    if (s.length === 8) break;
  }
  while (s.length < 8) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `${prefix}-${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

/* ---------- delivery ---------- */

export async function logEmail(env, { subscriber_id = null, to, kind, status, provider_id = null, error = null }) {
  try {
    await env.DB.prepare(
      "INSERT INTO email_log (subscriber_id, to_email, kind, provider, provider_id, status, error) VALUES (?, ?, ?, 'resend', ?, ?, ?)"
    ).bind(subscriber_id, to, kind, provider_id, status, error ? String(error).slice(0, 500) : null).run();
  } catch (e) {
    console.error("email_log failed:", e?.message || e);
  }
}

/** Mark the subscriber row after a welcome/resend attempt. */
export async function markWelcome(env, subscriber_id, status) {
  if (!subscriber_id) return;
  try {
    await env.DB.prepare(
      "UPDATE subscribers SET welcome_status = ?, welcome_sent_at = CASE WHEN ? = 'sent' THEN ? ELSE welcome_sent_at END WHERE id = ?"
    ).bind(status, status, now(), subscriber_id).run();
  } catch (e) {
    console.error("markWelcome failed:", e?.message || e);
  }
}

/**
 * Send the current welcome template to `to` via Resend, write email_log and
 * (for kind welcome/resend) the subscriber's welcome_status.
 * Never throws. → { sent, id?, error?, status }
 */
export async function sendTemplateEmail(env, { to, subscriber_id = null, kind = "welcome", code = "", settings = null }) {
  const isWelcome = kind === "welcome" || kind === "resend";
  if (!isEmailConfigured(env)) {
    await logEmail(env, { subscriber_id, to, kind, status: "skipped", error: "no_resend_key" });
    if (isWelcome) await markWelcome(env, subscriber_id, "skipped");
    return { sent: false, status: "skipped", error: "no_resend_key" };
  }

  let result;
  try {
    const s = settings || await getSettings(env);
    const vars = templateVars(env, s, { email: to, code });
    const { subject, html, text } = renderEmail(env, s, vars);
    const payload = {
      from: `${s.from_name} <${s.from_email}>`,
      to: [to],
      subject, html, text,
      headers: { "X-Entity-Ref-ID": crypto.randomUUID() },
    };
    if (s.reply_to) payload.reply_to = s.reply_to;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) {
      const data = await r.json().catch(() => ({}));
      result = { sent: true, status: "sent", id: data.id || null };
    } else {
      const detail = (await r.text().catch(() => "")).slice(0, 300);
      result = { sent: false, status: "failed", error: `resend_${r.status}${detail ? ": " + detail : ""}` };
    }
  } catch (e) {
    result = { sent: false, status: "failed", error: `exception: ${String(e?.message || e).slice(0, 200)}` };
  }

  await logEmail(env, { subscriber_id, to, kind, status: result.status, provider_id: result.id || null, error: result.error || null });
  // A failed *resend* must not downgrade a lead that already received its welcome.
  if (kind === "welcome" || (kind === "resend" && result.sent)) await markWelcome(env, subscriber_id, result.status);
  return result;
}

/* ---------- default template (placeholder copy — editable in the admin) ---------- */

const DEFAULT_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>You're on the list — Atomik Selections</title>
</head>
<body style="margin:0;padding:0;background:#12062B;color:#F6F1FF;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">Your exclusive {{discount}} code is inside. Keep it safe until launch.</span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#12062B;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;">

          <tr>
            <td align="center" style="padding:0 0 28px;">
              <a href="{{site_url}}" style="text-decoration:none;">
                <img src="{{site_url}}/assets/logo-color-1200.png" width="280" alt="Atomik Selections" style="display:block;width:280px;max-width:80%;height:auto;border:0;">
              </a>
            </td>
          </tr>

          <tr>
            <td style="height:4px;background:linear-gradient(90deg,#FFE93B 0%,#FF2FA0 50%,#3FDCF0 100%);background-color:#FF2FA0;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <tr>
            <td style="background:#1B0A3D;padding:36px 32px 32px;border:1px solid #2E1660;border-top:0;">
              <p style="margin:0 0 10px;font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:#3FDCF0;">Signal locked</p>
              <h1 style="margin:0 0 18px;font-size:28px;line-height:1.2;font-weight:800;color:#FFFFFF;">You're on the list.</h1>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#E6DDF7;">
                Thanks for joining Atomik Selections before launch. As one of the first on board, you'll get an
                <strong style="color:#FFE93B;">exclusive {{discount}}</strong> when we open the doors.
              </p>
              <p style="margin:0 0 10px;font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#B8A6E0;">Your personal code</p>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center" style="background:#0F0520;border:2px solid #FF2FA0;border-radius:12px;padding:22px 16px;">
                    <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:30px;line-height:1.2;letter-spacing:.14em;font-weight:700;color:#FFE93B;">{{code}}</span>
                  </td>
                </tr>
              </table>

              <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#B8A6E0;">
                Keep this email — we'll tell you exactly how to redeem the code the moment
                <a href="{{site_url}}" style="color:#3FDCF0;text-decoration:none;">atomikselections.com</a> goes live.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 12px 0;text-align:center;font-size:12px;line-height:1.7;color:#8C7BB5;">
              <span style="color:#FF2FA0;font-weight:700;">21+</span> · For adults only. Please enjoy responsibly and in accordance with your local laws.<br>
              You're receiving this because you joined the list at atomikselections.com with {{email}}.<br>
              © Atomik Selections
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const DEFAULT_TEXT = `ATOMIK SELECTIONS — SIGNAL LOCKED

You're on the list.

Thanks for joining Atomik Selections before launch. As one of the first on board,
you'll get an exclusive {{discount}} when we open the doors.

YOUR PERSONAL CODE

    {{code}}

Keep this email — we'll tell you exactly how to redeem the code the moment
{{site_url}} goes live.

—
21+ · For adults only. Please enjoy responsibly and in accordance with your local laws.
You're receiving this because you joined the list at atomikselections.com with {{email}}.
© Atomik Selections`;
