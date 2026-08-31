import { json } from "../../../_lib.js";
import { leadsQuery, LEAD_COLUMNS } from "../../../_leads.js";

export async function onRequestGet({ request, env }) {
  const q = leadsQuery(new URL(request.url).searchParams);
  const [count, rows] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM subscribers ${q.where}`).bind(...q.params),
    env.DB.prepare(`SELECT ${LEAD_COLUMNS} FROM subscribers ${q.where} ${q.orderBy} LIMIT ? OFFSET ?`)
      .bind(...q.params, q.per, (q.page - 1) * q.per),
  ]);
  return json({
    rows: rows.results || [],
    total: count.results?.[0]?.n || 0,
    page: q.page,
    per: q.per,
    filters: q.filters,
  });
}
