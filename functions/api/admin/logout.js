import { json, audit } from "../../_lib.js";
import { clearSessionCookie } from "../../_auth.js";

export async function onRequestPost({ request, env, data }) {
  await audit(env, { admin: data.admin, action: "logout", ip: data.ip });
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
}
