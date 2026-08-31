import { json, fail, audit, pick } from "../../../_lib.js";

export async function onRequestDelete({ env, data, params }) {
  const id = pick.int(params.id, 0, 0, Number.MAX_SAFE_INTEGER);
  if (!id) return fail("not_found", 404);
  if (id === data.admin.id) return fail("cannot_delete_self", 400, "You cannot delete your own account.");

  const [target, count] = await env.DB.batch([
    env.DB.prepare("SELECT id, email FROM admins WHERE id = ?").bind(id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM admins"),
  ]);
  const row = target.results?.[0];
  if (!row) return fail("not_found", 404);
  if ((count.results?.[0]?.n || 0) <= 1) return fail("last_admin", 400, "Cannot delete the last admin.");

  await env.DB.prepare("DELETE FROM admins WHERE id = ?").bind(id).run();
  await audit(env, { admin: data.admin, action: "admin_delete", target: row.email, ip: data.ip });
  return json({ ok: true });
}
