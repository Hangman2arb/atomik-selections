/* Shared filter/sort builder for /api/admin/leads and /api/admin/export.csv */

import { pick } from "./_lib.js";

export const LEAD_COLUMNS =
  "id, email, created_at, country, source, discount_code, welcome_status, welcome_sent_at, notes, unsubscribed_at";

const SORTS = { created_at: "created_at", email: "email COLLATE NOCASE", country: "country" };
const STATUSES = new Set(["sent", "failed", "pending", "unsubscribed"]);

/** Parse query params into { where, params, orderBy, page, per, filters }. All values are bound. */
export function leadsQuery(searchParams) {
  const q = pick.str(searchParams.get("q"), 200).toLowerCase();
  const country = pick.str(searchParams.get("country"), 2).toUpperCase();
  const statusRaw = pick.str(searchParams.get("status"), 20).toLowerCase();
  const status = STATUSES.has(statusRaw) ? statusRaw : "";
  const from = pick.day(searchParams.get("from"));
  const to = pick.day(searchParams.get("to"));
  const sortKey = SORTS[searchParams.get("sort")] ? searchParams.get("sort") : "created_at";
  const dir = searchParams.get("dir") === "asc" ? "ASC" : "DESC";
  const page = pick.int(searchParams.get("page"), 1, 1, 100_000);
  const per = pick.int(searchParams.get("per"), 50, 1, 200);

  const where = [];
  const params = [];
  if (q) {
    // Escape LIKE wildcards so a search for "%" or "_" is literal.
    where.push("(lower(email) LIKE ? ESCAPE '\\' OR discount_code = ? OR lower(notes) LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    params.push(like, q.toUpperCase(), like);
  }
  if (country) { where.push("country = ?"); params.push(country); }
  if (status === "sent" || status === "failed") { where.push("welcome_status = ?"); params.push(status); }
  else if (status === "pending") where.push("(welcome_status IS NULL OR welcome_status NOT IN ('sent','failed'))");
  else if (status === "unsubscribed") where.push("unsubscribed_at IS NOT NULL");
  if (from != null) { where.push("created_at >= ?"); params.push(from); }
  if (to != null) { where.push("created_at < ?"); params.push(to + 86400); }

  return {
    where: where.length ? "WHERE " + where.join(" AND ") : "",
    params,
    orderBy: `ORDER BY ${SORTS[sortKey]} ${dir}, id ${dir}`,
    page, per,
    filters: { q, country, status, from: searchParams.get("from") || "", to: searchParams.get("to") || "", sort: sortKey, dir: dir.toLowerCase() },
  };
}
