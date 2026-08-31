import { EMAIL_RE, json, fail, readJson, rateLimit, audit, pick } from "../../../_lib.js";
import { getSettings, isEmailConfigured, generateDiscountCode, sendTemplateEmail } from "../../../_email.js";

export async function onRequestPost({ request, env, data }) {
  const { body, error } = await readJson(request, { maxBytes: 4096 });
  if (error) return error;

  const to = pick.str(body.to, 254).toLowerCase();
  if (!EMAIL_RE.test(to)) return fail("validation", 400, "`to` must be a valid email address.");
  if (!isEmailConfigured(env)) return fail("email_not_configured", 409, "RESEND_API_KEY is not set.");
  if (!(await rateLimit(env, `emailtest:${data.admin.id}`, { window: 15 * 60, max: 10 }))) {
    return fail("rate_limited", 429, "Too many test emails. Try again in 15 minutes.");
  }

  const settings = await getSettings(env);
  const isAdmin = await env.DB.prepare("SELECT 1 FROM admins WHERE email = ?").bind(to).first();
  if (!isAdmin && to !== settings.reply_to) {
    return fail("recipient_not_allowed", 403, "Test emails can only go to an admin address or the reply-to address.");
  }

  const result = await sendTemplateEmail(env, {
    to, kind: "test", settings,
    code: generateDiscountCode(settings.discount_prefix),
  });
  await audit(env, { admin: data.admin, action: "email_test", target: to, ip: data.ip });
  return json({ ok: result.sent, sent: result.sent, id: result.id || null, error: result.error || null });
}
