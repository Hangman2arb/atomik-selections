import { json } from "../../_lib.js";
import { isEmailConfigured } from "../../_email.js";

export function onRequestGet({ env, data }) {
  const { id, email, name, must_change } = data.admin;
  return json({
    admin: { id, email, name, must_change: Boolean(must_change) },
    email_configured: isEmailConfigured(env),
    version: (env.CF_PAGES_COMMIT_SHA || "dev").slice(0, 7),
  });
}
