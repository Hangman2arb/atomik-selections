import { json, now, pick } from "../../_lib.js";

const DAY = 86400;
const SERIES_DAYS = 60;

/* Day boundaries ("today", the 60-day series) follow the admin's clock: the
   UI sends `?tz=<minutes>` = `new Date().getTimezoneOffset()` (UTC = local + tz,
   so Madrid in summer is -120). The offset is applied inside SQL with
   `date(created_at - tz*60, 'unixepoch')`. It is the browser's *current*
   offset, so within a 60-day window that straddles a DST switch the days
   before the switch are bucketed one hour off — accepted for a simple,
   tz-database-free query; the day labels are the local calendar dates. */
export async function onRequestGet({ request, env }) {
  const tz = pick.int(new URL(request.url).searchParams.get("tz"), 0, -1000, 1000);
  const shift = tz * 60;                          // seconds to subtract from UTC to get the local clock
  const ts = now();
  const local = ts - shift;
  const localDayStart = local - (local % DAY);    // local midnight, on the local clock
  const todayStart = localDayStart + shift;       // …as a UTC instant
  const seriesStartLocal = localDayStart - (SERIES_DAYS - 1) * DAY;
  const seriesStart = seriesStartLocal + shift;

  const [totals, countries, series, latest] = await env.DB.batch([
    env.DB.prepare(`
      SELECT COUNT(*) AS total,
        SUM(created_at >= ?1) AS today,
        SUM(created_at >= ?2) AS last7,
        SUM(created_at >= ?3) AS last30,
        SUM(created_at >= ?4 AND created_at < ?2) AS prev7,
        SUM(welcome_status = 'sent') AS sent,
        SUM(welcome_status = 'failed') AS failed,
        SUM(welcome_status IS NULL) AS pending,
        SUM(welcome_status = 'skipped') AS skipped
      FROM subscribers`).bind(todayStart, ts - 7 * DAY, ts - 30 * DAY, ts - 14 * DAY),
    env.DB.prepare(
      "SELECT country, COUNT(*) AS n FROM subscribers WHERE country IS NOT NULL AND country != '' GROUP BY country ORDER BY n DESC, country ASC LIMIT 10"
    ),
    env.DB.prepare(
      "SELECT date(created_at - ?1, 'unixepoch') AS day, COUNT(*) AS n FROM subscribers WHERE created_at >= ?2 GROUP BY day"
    ).bind(shift, seriesStart),
    env.DB.prepare(
      "SELECT id, email, created_at, country, discount_code, welcome_status FROM subscribers ORDER BY id DESC LIMIT 5"
    ),
  ]);

  const t = totals.results[0] || {};
  const byDay = new Map((series.results || []).map((r) => [r.day, r.n]));
  const filled = [];
  for (let i = 0; i < SERIES_DAYS; i++) {
    const day = new Date((seriesStartLocal + i * DAY) * 1000).toISOString().slice(0, 10);
    filled.push({ day, n: byDay.get(day) || 0 });
  }

  return json({
    total: t.total || 0,
    today: t.today || 0,
    last7: t.last7 || 0,
    last30: t.last30 || 0,
    prev7: t.prev7 || 0,
    // pending = never attempted (NULL); skipped = welcome disabled / no RESEND_API_KEY at signup time.
    welcome: { sent: t.sent || 0, failed: t.failed || 0, pending: t.pending || 0, skipped: t.skipped || 0 },
    by_country: countries.results || [],
    series: filled,
    latest: latest.results || [],
    tz,
  });
}
