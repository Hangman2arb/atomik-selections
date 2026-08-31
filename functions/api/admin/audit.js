import { json, pick } from "../../_lib.js";

const PER = 50;

export async function onRequestGet({ request, env }) {
  const page = pick.int(new URL(request.url).searchParams.get("page"), 1, 1, 100_000);
  const [count, rows] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM admin_audit"),
    env.DB.prepare("SELECT id, admin_email, action, target, ip, created_at FROM admin_audit ORDER BY id DESC LIMIT ? OFFSET ?")
      .bind(PER, (page - 1) * PER),
  ]);
  return json({ rows: rows.results || [], total: count.results?.[0]?.n || 0, page, per: PER });
}
