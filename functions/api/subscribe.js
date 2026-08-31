import {
  EMAIL_RE,
  corsHeaders,
  json,
  rateLimit,
  verifyTurnstile,
} from "../_lib.js";
import {
  getSettings,
  isEmailConfigured,
  generateDiscountCode,
  sendTemplateEmail,
  logEmail,
  markWelcome,
} from "../_email.js";

const CODE_ATTEMPTS = 5;
// How long we wait for Resend before answering "queued" and letting waitUntil finish the job.
const MAIL_WAIT_MS = 1500;

export async function onRequestOptions({ request, env }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("Origin") || "", env),
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const cors = corsHeaders(origin, env);

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ua = (request.headers.get("User-Agent") || "").slice(0, 300);
  const country = request.headers.get("CF-IPCountry") || "";

  let body;
  try {
    body = await request.json();
  } catch {
    return withCors(json({ status: "invalid", reason: "bad_json" }, 400), cors);
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const honeypot = String(body?.h_orbit || "");
  const turnstileToken = body?.cf_turnstile || "";

  if (honeypot.length > 0) {
    return withCors(json({ status: "blocked", reason: "honeypot" }, 200), cors);
  }
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return withCors(json({ status: "invalid", reason: "bad_email" }, 200), cors);
  }

  const ok = await rateLimit(env, ip);
  if (!ok) {
    return withCors(json({ status: "blocked", reason: "rate_limit" }, 429), cors);
  }

  const human = await verifyTurnstile(env, turnstileToken, ip);
  if (!human) {
    return withCors(json({ status: "blocked", reason: "turnstile" }, 200), cors);
  }

  let settings;
  try {
    settings = await getSettings(env);
  } catch {
    return withCors(json({ status: "error", reason: "db" }, 500), cors);
  }

  // Insert with a unique discount code; retry only on a code collision.
  let inserted = null;
  for (let attempt = 0; attempt < CODE_ATTEMPTS && !inserted; attempt++) {
    const code = settings.discount_enabled ? generateDiscountCode(settings.discount_prefix) : null;
    try {
      inserted = await env.DB.prepare(
        "INSERT INTO subscribers (email, ip, ua, source, country, discount_code) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, discount_code"
      ).bind(email, ip, ua, "landing", country, code).first();
    } catch (e) {
      const msg = String(e?.message || e).toLowerCase();
      if (msg.includes("unique") || msg.includes("constraint")) {
        if (code && msg.includes("discount_code")) continue;
        return withCors(json({ status: "already" }, 200), cors);
      }
      return withCors(json({ status: "error", reason: "db" }, 500), cors);
    }
  }
  if (!inserted) {
    return withCors(json({ status: "error", reason: "db" }, 500), cors);
  }

  // Welcome email. Failures never change the HTTP result.
  if (!settings.welcome_enabled || !isEmailConfigured(env)) {
    const reason = settings.welcome_enabled ? "no_resend_key" : "welcome_disabled";
    await Promise.all([
      logEmail(env, { subscriber_id: inserted.id, to: email, kind: "welcome", status: "skipped", error: reason }),
      markWelcome(env, inserted.id, "skipped"),
    ]);
    return withCors(json({ status: "new", mailed: false }, 200), cors);
  }

  const sending = sendTemplateEmail(env, {
    to: email, subscriber_id: inserted.id, kind: "welcome", code: inserted.discount_code || "", settings,
  }).catch(() => ({ sent: false }));
  if (typeof context.waitUntil === "function") context.waitUntil(sending);

  // Answer quickly. `mailed:true` only when Resend has actually accepted the
  // message; if it is still in flight after MAIL_WAIT_MS the send continues in
  // waitUntil and the landing gets `mailed:false, queued:true`.
  const result = await Promise.race([
    sending,
    new Promise((r) => setTimeout(() => r({ queued: true }), MAIL_WAIT_MS)),
  ]);
  if (result.queued) return withCors(json({ status: "new", mailed: false, queued: true }, 200), cors);
  return withCors(json({ status: "new", mailed: result.sent === true }, 200), cors);
}

function withCors(res, cors) {
  Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}
