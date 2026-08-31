import { csvCell, csvResponse, toIso } from "../../_lib.js";

/** Legacy CSV export (auth handled by _middleware.js: session cookie or Bearer ADMIN_TOKEN). */
export async function onRequestGet({ env }) {
  const { results } = await env.DB
    .prepare("SELECT id, email, created_at, country, source FROM subscribers ORDER BY id DESC")
    .all();

  const lines = ["id,email,created_at_iso,country,source"];
  for (const r of results || []) {
    lines.push([r.id, r.email, toIso(r.created_at), r.country, r.source].map(csvCell).join(","));
  }
  return csvResponse(lines, `atomik-subscribers-${Date.now()}.csv`);
}
