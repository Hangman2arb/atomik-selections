import { EMAIL_RE, json, fail, readJson, rateLimit, rateLimitCheck, clientIp, audit, pick } from "../../_lib.js";
import { PASSWORD_MAX, verifyPassword, fakeVerify, getSessionSecret, signSession, sessionCookie } from "../../_auth.js";

/* Only FAILED logins count: `login:<ip>` (10 / 15 min) and `login:e:<email>`
   (10 / 15 min per account, so one attacker IP cannot be swapped around a
   single account and a legitimate admin is never locked out by their own
   successful logins). Both keys are peeked first and hit on failure only. */
const LOGIN_LIMIT = { window: 15 * 60, max: 10 };

export async function onRequestPost({ request, env }) {
  const ip = clientIp(request);
  const ipKey = `login:${ip || "unknown"}`;
  const limited = fail("rate_limited", 429, "Too many attempts. Try again in 15 minutes.");
  if (!(await rateLimitCheck(env, ipKey, LOGIN_LIMIT))) return limited;

  const { body, error } = await readJson(request, { maxBytes: 4096 });
  if (error) return error;

  const email = pick.str(body.email, 254).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const emailKey = EMAIL_RE.test(email) ? `login:e:${email}` : "";
  if (emailKey && !(await rateLimitCheck(env, emailKey, LOGIN_LIMIT))) return limited;

  const failed = async () => {
    await Promise.all([rateLimit(env, ipKey, LOGIN_LIMIT), emailKey ? rateLimit(env, emailKey, LOGIN_LIMIT) : null]);
    return fail("invalid_credentials", 401, "Invalid email or password.");
  };
  if (!emailKey || !password || password.length > PASSWORD_MAX) return failed();

  const admin = await env.DB
    .prepare("SELECT id, email, name, pass_hash, pass_salt, iterations, pass_version, must_change FROM admins WHERE email = ?")
    .bind(email).first();

  const ok = admin ? await verifyPassword(password, admin) : await fakeVerify();
  if (!ok) {
    await audit(env, { admin: { email }, action: "login_failed", ip });
    return failed();
  }

  const { secret } = await getSessionSecret(env);
  const token = await signSession(secret, { sub: admin.id, email: admin.email, pv: admin.pass_version });
  await env.DB.batch([
    env.DB.prepare("UPDATE admins SET last_login_at = unixepoch() WHERE id = ?").bind(admin.id),
    env.DB.prepare("INSERT INTO admin_audit (admin_email, action, ip) VALUES (?, 'login', ?)").bind(admin.email, ip || null),
  ]);

  return json(
    { ok: true, must_change: Boolean(admin.must_change), admin: { email: admin.email, name: admin.name } },
    200,
    { "Set-Cookie": sessionCookie(token, request) },
  );
}
