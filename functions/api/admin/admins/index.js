import { EMAIL_RE, json, fail, readJson, audit, pick } from "../../../_lib.js";
import { generateTempPassword, hashPassword } from "../../../_auth.js";

export async function onRequestGet({ env }) {
  const { results } = await env.DB
    .prepare("SELECT id, email, name, created_at, last_login_at, must_change FROM admins ORDER BY id ASC").all();
  return json(results || []);
}

export async function onRequestPost({ request, env, data }) {
  const { body, error } = await readJson(request, { maxBytes: 4096 });
  if (error) return error;

  const email = pick.str(body.email, 254).toLowerCase();
  const name = pick.str(body.name, 100);
  if (!EMAIL_RE.test(email)) return fail("validation", 400, "email must be a valid address");
  if (!name) return fail("validation", 400, "name is required");

  const temp = generateTempPassword(20);
  const h = await hashPassword(temp);
  let row;
  try {
    row = await env.DB.prepare(
      "INSERT INTO admins (email, name, pass_hash, pass_salt, iterations, must_change, created_by) VALUES (?, ?, ?, ?, ?, 1, ?) RETURNING id, email, name, created_at, must_change"
    ).bind(email, name, h.pass_hash, h.pass_salt, h.iterations, data.admin.email).first();
  } catch (e) {
    if (/unique|constraint/i.test(String(e?.message || e))) return fail("email_taken", 409, "An admin with that email already exists.");
    throw e;
  }

  await audit(env, { admin: data.admin, action: "admin_create", target: email, ip: data.ip });
  // The temp password is returned exactly once and never stored in clear.
  return json({ ok: true, admin: row, temp_password: temp }, 201);
}
