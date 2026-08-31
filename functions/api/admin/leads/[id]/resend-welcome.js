import { json, fail, audit, pathId, leadTarget } from "../../../../_lib.js";
import { getSettings, isEmailConfigured, generateDiscountCode, sendTemplateEmail } from "../../../../_email.js";

export async function onRequestPost({ env, data, params }) {
  const id = pathId(params.id);
  if (!id) return fail("not_found", 404);
  if (!isEmailConfigured(env)) return fail("email_not_configured", 409, "RESEND_API_KEY is not set.");

  const row = await env.DB
    .prepare("SELECT id, email, discount_code, unsubscribed_at FROM subscribers WHERE id = ?")
    .bind(id).first();
  if (!row) return fail("not_found", 404);
  if (row.unsubscribed_at) return fail("unsubscribed", 409, "This lead has unsubscribed.");

  const settings = await getSettings(env);
  let code = row.discount_code;
  if (!code && settings.discount_enabled) {
    // Older rows (pre-backoffice) have no code yet: assign one now.
    for (let attempt = 0; attempt < 5 && !code; attempt++) {
      const candidate = generateDiscountCode(settings.discount_prefix);
      try {
        await env.DB.prepare("UPDATE subscribers SET discount_code = ? WHERE id = ?").bind(candidate, id).run();
        code = candidate;
      } catch (e) {
        if (!/unique|constraint/i.test(String(e?.message || e))) throw e;
      }
    }
  }

  const result = await sendTemplateEmail(env, { to: row.email, subscriber_id: row.id, kind: "resend", code: code || "", settings });
  await audit(env, { admin: data.admin, action: "resend_welcome", target: leadTarget(row), ip: data.ip });
  return json({ ok: result.sent, sent: result.sent, id: result.id || null, error: result.error || null });
}
