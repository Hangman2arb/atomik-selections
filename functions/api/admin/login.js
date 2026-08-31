import { EMAIL_RE, json, fail, readJson, rateLimit, clientIp, audit, pick } from "../../_lib.js";
import { PASSWORD_MAX, verifyPassword, fakeVerify, getSessionSecret, signSession, sessionCookie } from "../../_auth.js";

const LOGIN_WINDOW = 15 * 60;
const LOGIN_MAX = 10;

export async function onRequestPost({ request, env }) {
  const ip = clientIp(request);
  const allowed = await rateLimit(env, `login:${ip || "unknown"}`, { window: LOGIN_WINDOW, max: LOGIN_MAX });
  if (!allowed) return fail("rate_limited", 429, "Too many attempts. Try again in 15 minutes.");

  const { body, error } = await readJson(request, { maxBytes: 4096 });
  if (error) return error;

  const email = pick.str(body.email, 254).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const invalid = fail("invalid_credentials", 401, "Invalid email or password.");
  if (!EMAIL_RE.test(email) || !password || password.length > PASSWORD_MAX) return invalid;

  const admin = await env.DB
    .prepare("SELECT id, email, name, pass_hash, pass_salt, iterations, pass_version, must_change FROM admins WHERE email = ?")
    .bind(email).first();

  const ok = admin ? await verifyPassword(password, admin) : await fakeVerify();
  if (!ok) {
    await audit(env, { admin: { email }, action: "login_failed", ip });
    return invalid;
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
