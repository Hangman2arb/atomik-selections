import { json } from "../../_lib.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ")
    ? auth.slice(7)
    : (url.searchParams.get("token") || "");

  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  const r = await env.DB.prepare("SELECT COUNT(*) as n FROM subscribers").first();
  return json({ count: r?.n ?? 0 });
}
