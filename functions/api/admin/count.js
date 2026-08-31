import { json } from "../../_lib.js";

/** Legacy endpoint (auth handled by _middleware.js: session cookie or Bearer ADMIN_TOKEN). */
export async function onRequestGet({ env }) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM subscribers").first();
  return json({ count: r?.n ?? 0 });
}
