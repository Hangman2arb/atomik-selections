import { json, fail, readJson, audit, pathId, leadTarget } from "../../../_lib.js";
import { LEAD_COLUMNS } from "../../../_leads.js";

const NOTES_MAX = 2000;

export async function onRequestPatch({ request, env, data, params }) {
  const id = pathId(params.id);
  if (!id) return fail("not_found", 404);
  const { body, error } = await readJson(request, { maxBytes: 16 * 1024 });
  if (error) return error;

  if (!("notes" in body)) return fail("nothing_to_update", 400, "Provide `notes`.");
  if (body.notes !== null && typeof body.notes !== "string") return fail("validation", 400, "notes must be a string or null");
  if (typeof body.notes === "string" && body.notes.length > NOTES_MAX) return fail("validation", 400, `notes max ${NOTES_MAX} characters`);
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  const row = await env.DB
    .prepare(`UPDATE subscribers SET notes = ? WHERE id = ? RETURNING ${LEAD_COLUMNS}`)
    .bind(notes, id).first();
  if (!row) return fail("not_found", 404);

  await audit(env, { admin: data.admin, action: "lead_note", target: leadTarget(row), ip: data.ip });
  return json(row);
}

export async function onRequestDelete({ env, data, params }) {
  const id = pathId(params.id);
  if (!id) return fail("not_found", 404);

  const row = await env.DB.prepare("SELECT id, email FROM subscribers WHERE id = ?").bind(id).first();
  if (!row) return fail("not_found", 404);

  // Erasure: drop the row, scrub the address from email_log, and scrub any
  // audit rows that still hold the full address (written before targets were
  // masked). What remains afterwards is `lead#<id> j***@domain` in admin_audit.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM subscribers WHERE id = ?").bind(id),
    env.DB.prepare("UPDATE email_log SET to_email = '[deleted]' WHERE subscriber_id = ?").bind(id),
    env.DB.prepare("UPDATE admin_audit SET target = '[deleted]' WHERE target = ?").bind(row.email),
  ]);
  await audit(env, { admin: data.admin, action: "lead_delete", target: leadTarget(row), ip: data.ip });
  return json({ ok: true });
}
