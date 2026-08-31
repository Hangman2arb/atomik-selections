import { json, pick } from "../../../_lib.js";

const PER = 20;

export async function onRequestGet({ request, env }) {
  const page = pick.int(new URL(request.url).searchParams.get("page"), 1, 1, 100_000);
  const [count, rows] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM email_log"),
    env.DB.prepare(`
      SELECT l.id, l.subscriber_id, l.to_email, l.kind, l.provider, l.provider_id, l.status, l.error, l.created_at,
             s.email AS subscriber_email
      FROM email_log l LEFT JOIN subscribers s ON s.id = l.subscriber_id
      ORDER BY l.id DESC LIMIT ? OFFSET ?`).bind(PER, (page - 1) * PER),
  ]);
  return json({ rows: rows.results || [], total: count.results?.[0]?.n || 0, page, per: PER });
}
