import {
  EMAIL_RE,
  corsHeaders,
  json,
  rateLimit,
  verifyTurnstile,
  sendWelcomeEmail,
} from "../_lib.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("Origin") || "", env),
  });
}

export async function onRequestPost({ request, env }) {
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

  try {
    await env.DB.prepare(
      "INSERT INTO subscribers (email, ip, ua, source, country) VALUES (?, ?, ?, ?, ?)"
    ).bind(email, ip, ua, "landing", country).run();
  } catch (e) {
    const msg = String(e?.message || e).toLowerCase();
    if (msg.includes("unique") || msg.includes("constraint")) {
      return withCors(json({ status: "already" }, 200), cors);
    }
    return withCors(json({ status: "error", reason: "db" }, 500), cors);
  }

  const mail = await sendWelcomeEmail(env, email);
  return withCors(json({ status: "new", mailed: mail.sent === true }, 200), cors);
}

function withCors(res, cors) {
  Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}
