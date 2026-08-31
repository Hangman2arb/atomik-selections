import { json, fail, audit, pathId } from "../../../_lib.js";

export async function onRequestDelete({ env, data, params }) {
  const id = pathId(params.id);
  if (!id) return fail("not_found", 404);
  if (id === data.admin.id) return fail("cannot_delete_self", 400, "You cannot delete your own account.");

  const row = await env.DB.prepare("SELECT id, email FROM admins WHERE id = ?").bind(id).first();
  if (!row) return fail("not_found", 404);

  // Atomic last-admin guard: the count is evaluated inside the same statement,
  // so two concurrent deletes cannot both pass a separate "count > 1" check.
  const r = await env.DB
    .prepare("DELETE FROM admins WHERE id = ? AND id <> ? AND (SELECT COUNT(*) FROM admins) > 1")
    .bind(id, data.admin.id).run();
  if (!r.meta?.changes) return fail("last_admin", 400, "Cannot delete the last admin.");

  await audit(env, { admin: data.admin, action: "admin_delete", target: row.email, ip: data.ip });
  return json({ ok: true });
}
