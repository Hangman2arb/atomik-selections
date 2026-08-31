import { json, now } from "../../_lib.js";

const DAY = 86400;
const SERIES_DAYS = 60;

export async function onRequestGet({ env }) {
  const ts = now();
  const todayStart = ts - (ts % DAY);
  const seriesStart = todayStart - (SERIES_DAYS - 1) * DAY;

  const [totals, countries, series, latest] = await env.DB.batch([
    env.DB.prepare(`
      SELECT COUNT(*) AS total,
        SUM(created_at >= ?1) AS today,
        SUM(created_at >= ?2) AS last7,
        SUM(created_at >= ?3) AS last30,
        SUM(created_at >= ?4 AND created_at < ?2) AS prev7,
        SUM(welcome_status = 'sent') AS sent,
        SUM(welcome_status = 'failed') AS failed,
        SUM(welcome_status IS NULL OR welcome_status NOT IN ('sent','failed')) AS pending
      FROM subscribers`).bind(todayStart, ts - 7 * DAY, ts - 30 * DAY, ts - 14 * DAY),
    env.DB.prepare(
      "SELECT country, COUNT(*) AS n FROM subscribers WHERE country IS NOT NULL AND country != '' GROUP BY country ORDER BY n DESC, country ASC LIMIT 10"
    ),
    env.DB.prepare(
      "SELECT date(created_at, 'unixepoch') AS day, COUNT(*) AS n FROM subscribers WHERE created_at >= ? GROUP BY day"
    ).bind(seriesStart),
    env.DB.prepare(
      "SELECT id, email, created_at, country, discount_code, welcome_status FROM subscribers ORDER BY id DESC LIMIT 5"
    ),
  ]);

  const t = totals.results[0] || {};
  const byDay = new Map((series.results || []).map((r) => [r.day, r.n]));
  const filled = [];
  for (let i = 0; i < SERIES_DAYS; i++) {
    const day = new Date((seriesStart + i * DAY) * 1000).toISOString().slice(0, 10);
    filled.push({ day, n: byDay.get(day) || 0 });
  }

  return json({
    total: t.total || 0,
    today: t.today || 0,
    last7: t.last7 || 0,
    last30: t.last30 || 0,
    prev7: t.prev7 || 0,
    welcome: { sent: t.sent || 0, failed: t.failed || 0, pending: t.pending || 0 },
    by_country: countries.results || [],
    series: filled,
    latest: latest.results || [],
  });
}
