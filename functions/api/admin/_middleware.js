/* Gate for everything under /api/admin/*.
   - CSRF guards on state-changing methods (same-origin Origin + JSON content type)
   - session cookie (HMAC) or `Authorization: Bearer <ADMIN_TOKEN>`
   - must_change gate (403 password_change_required)
   - Cache-Control: no-store on every response; generic 500 on unexpected errors
   The admin API is same-origin only: no CORS headers, OPTIONS → 405. */

import { fail, clientIp } from "../../_lib.js";
import { SESSION_COOKIE, parseCookies, verifySession, getSessionSecret, safeEqualStrings } from "../../_auth.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const OPEN = [["POST", "/api/admin/login"]];
const ALLOWED_WHILE_MUST_CHANGE = [
  ["PUT", "/api/admin/password"],
  ["GET", "/api/admin/me"],
  ["POST", "/api/admin/logout"],
];

const matches = (list, method, path) => list.some(([m, p]) => m === method && p === path);

export async function onRequest(context) {
  const { request } = context;
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  const method = request.method.toUpperCase();

  let res;
  try {
    res = await guard(context, path, method);
  } catch (e) {
    console.error(`admin api ${method} ${path}: ${e?.message || e}`);
    res = fail("server_error", 500);
  }
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "no-store");
  out.headers.set("X-Robots-Tag", "noindex, nofollow");
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Referrer-Policy", "no-referrer");
  return out;
}

async function guard(context, path, method) {
  const { request, env, next, data } = context;
  if (!env.DB) return fail("db_unavailable", 503);
  if (method === "OPTIONS") return fail("method_not_allowed", 405);

  if (MUTATING.has(method)) {
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) return fail("bad_origin", 403);
    const ct = (request.headers.get("Content-Type") || "").toLowerCase();
    if (!ct.startsWith("application/json")) {
      return fail("bad_content_type", 415, "Content-Type must be application/json");
    }
  }

  if (matches(OPEN, method, path)) return next();

  const authz = request.headers.get("Authorization") || "";
  if (authz.startsWith("Bearer ")) {
    const token = authz.slice(7).trim();
    if (!env.ADMIN_TOKEN || !token || !(await safeEqualStrings(token, env.ADMIN_TOKEN))) {
      return fail("unauthorized", 401);
    }
    data.admin = { id: 0, email: "api-token", name: "API token", must_change: 0, via: "token" };
    data.ip = clientIp(request);
    return next();
  }

  const token = parseCookies(request.headers.get("Cookie"))[SESSION_COOKIE];
  if (!token) return fail("unauthorized", 401);
  const { secret } = await getSessionSecret(env);
  const session = await verifySession(secret, token);
  if (!session) return fail("unauthorized", 401);

  const admin = await env.DB
    .prepare("SELECT id, email, name, pass_version, must_change FROM admins WHERE id = ?")
    .bind(session.sub).first();
  if (!admin || admin.pass_version !== session.pv) return fail("unauthorized", 401);

  data.admin = { id: admin.id, email: admin.email, name: admin.name, must_change: admin.must_change, via: "cookie" };
  data.session = session;
  data.secret = secret;
  data.ip = clientIp(request);

  if (admin.must_change && !matches(ALLOWED_WHILE_MUST_CHANGE, method, path)) {
    return fail("password_change_required", 403);
  }
  return next();
}
