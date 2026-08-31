import { json, audit } from "../../_lib.js";
import { clearSessionCookies } from "../../_auth.js";

/* "Sign out everywhere": besides clearing the cookie, bump pass_version so every
   session of this admin (other devices, a copied cookie) stops verifying. */
export async function onRequestPost({ request, env, data }) {
  if (data.admin.via === "cookie") {
    await env.DB.prepare("UPDATE admins SET pass_version = pass_version + 1 WHERE id = ?").bind(data.admin.id).run();
  }
  await audit(env, { admin: data.admin, action: "logout", ip: data.ip });
  const res = json({ ok: true });
  for (const c of clearSessionCookies(request)) res.headers.append("Set-Cookie", c);
  return res;
}
