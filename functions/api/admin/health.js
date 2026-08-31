import { json } from "../../_lib.js";
import { isEmailConfigured } from "../../_email.js";

export async function onRequestGet({ env }) {
  let db = false;
  try { db = (await env.DB.prepare("SELECT 1 AS one").first("one")) === 1; } catch {}
  return json({
    ok: db,
    db,
    email_configured: isEmailConfigured(env),
    session_secret: env.SESSION_SECRET ? "env" : "db",
  }, db ? 200 : 503);
}
