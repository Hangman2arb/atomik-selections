import { json, fail, readJson, rateLimit, audit } from "../../_lib.js";
import { validatePassword, verifyPassword, hashPassword, signSession, sessionCookie } from "../../_auth.js";

const CHANGE_LIMIT = { window: 15 * 60, max: 5 }; // per admin id

export async function onRequestPut({ request, env, data }) {
  if (data.admin.via !== "cookie") return fail("not_available_for_token", 403);
  const { body, error } = await readJson(request, { maxBytes: 4096 });
  if (error) return error;

  const current = typeof body.current === "string" ? body.current : "";
  const next = typeof body.next === "string" ? body.next : "";
  const problem = validatePassword(next);
  if (problem) return fail("weak_password", 400, problem);
  if (next === current) return fail("same_password", 400, "New password must differ from the current one.");

  // A logged-in session must not be able to brute-force the current password.
  if (!(await rateLimit(env, `pwchange:${data.admin.id}`, CHANGE_LIMIT))) {
    return fail("rate_limited", 429, "Too many password attempts. Try again in 15 minutes.");
  }

  const row = await env.DB
    .prepare("SELECT id, pass_hash, pass_salt, iterations FROM admins WHERE id = ?")
    .bind(data.admin.id).first();
  if (!row || !(await verifyPassword(current, row))) {
    await audit(env, { admin: data.admin, action: "password_change_failed", ip: data.ip });
    // 403, not 401: the session is fine, only the confirmation failed (the UI treats 401 as session loss).
    return fail("wrong_current_password", 403, "Current password is incorrect.");
  }

  const h = await hashPassword(next);
  const updated = await env.DB.prepare(
    "UPDATE admins SET pass_hash = ?, pass_salt = ?, iterations = ?, pass_version = pass_version + 1, must_change = 0 WHERE id = ? RETURNING pass_version"
  ).bind(h.pass_hash, h.pass_salt, h.iterations, row.id).first();

  await audit(env, { admin: data.admin, action: "password_change", ip: data.ip });
  const token = await signSession(data.secret, { sub: row.id, email: data.admin.email, pv: updated.pass_version });
  return json({ ok: true, must_change: false }, 200, { "Set-Cookie": sessionCookie(token, request) });
}
