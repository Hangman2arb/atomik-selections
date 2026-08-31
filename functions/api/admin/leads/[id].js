import { json, fail, readJson, audit, pick } from "../../../_lib.js";
import { LEAD_COLUMNS } from "../../../_leads.js";

const NOTES_MAX = 2000;

function leadId(params) {
  const id = pick.int(params.id, 0, 0, Number.MAX_SAFE_INTEGER);
  return id > 0 && String(id) === String(params.id) ? id : null;
}

export async function onRequestPatch({ request, env, data, params }) {
  const id = leadId(params);
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

  await audit(env, { admin: data.admin, action: "lead_note", target: row.email, ip: data.ip });
  return json(row);
}

export async function onRequestDelete({ env, data, params }) {
  const id = leadId(params);
  if (!id) return fail("not_found", 404);

  const row = await env.DB.prepare("SELECT id, email FROM subscribers WHERE id = ?").bind(id).first();
  if (!row) return fail("not_found", 404);

  // Hard delete + scrub the address from the email log so erasure is complete.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM subscribers WHERE id = ?").bind(id),
    env.DB.prepare("UPDATE email_log SET to_email = '[deleted]' WHERE subscriber_id = ?").bind(id),
  ]);
  await audit(env, { admin: data.admin, action: "lead_delete", target: row.email, ip: data.ip });
  return json({ ok: true });
}
