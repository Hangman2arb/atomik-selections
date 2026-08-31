import { json, fail, readJson, audit } from "../../_lib.js";
import { getSettings, saveSettings, validateSettings, defaults, TEMPLATE_VARS, LIMITS, isEmailConfigured } from "../../_email.js";

export async function onRequestGet({ env }) {
  return json({
    settings: await getSettings(env),
    defaults: defaults(env),
    variables: TEMPLATE_VARS,
    limits: LIMITS,
    email_configured: isEmailConfigured(env),
  });
}

export async function onRequestPut({ request, env, data }) {
  const { body, error } = await readJson(request, { maxBytes: 512 * 1024 });
  if (error) return error;

  // Current settings are passed so cross-field rules (discount label ↔ toggle) see the merged result.
  const { value, errors } = validateSettings(body, await getSettings(env));
  if (Object.keys(errors).length) return json({ error: "validation", fields: errors }, 400);
  if (!Object.keys(value).length) return fail("nothing_to_update", 400);

  await saveSettings(env, value, data.admin.email);
  await audit(env, { admin: data.admin, action: "settings_update", target: Object.keys(value).join(","), ip: data.ip });
  return json({ ok: true, settings: await getSettings(env) });
}
