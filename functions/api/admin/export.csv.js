import { csvCell, csvResponse, toIso } from "../../_lib.js";
import { leadsQuery } from "../../_leads.js";

/** Same filters as /api/admin/leads, no paging. */
export async function onRequestGet({ request, env }) {
  const q = leadsQuery(new URL(request.url).searchParams);
  const { results } = await env.DB
    .prepare(`SELECT id, email, created_at, country, source, discount_code, welcome_status FROM subscribers ${q.where} ${q.orderBy}`)
    .bind(...q.params).all();

  const lines = ["id,email,created_at_iso,country,source,discount_code,welcome_status"];
  for (const r of results || []) {
    lines.push([r.id, r.email, toIso(r.created_at), r.country, r.source, r.discount_code, r.welcome_status].map(csvCell).join(","));
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return csvResponse(lines, `atomik-leads-${stamp}.csv`);
}
