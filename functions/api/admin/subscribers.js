export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ")
    ? auth.slice(7)
    : (url.searchParams.get("token") || "");

  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { results } = await env.DB
    .prepare("SELECT id, email, created_at, country, source FROM subscribers ORDER BY id DESC")
    .all();

  const rows = ["id,email,created_at_iso,country,source"];
  for (const r of results) {
    const iso = new Date((r.created_at || 0) * 1000).toISOString();
    rows.push([
      r.id,
      JSON.stringify(r.email),
      iso,
      JSON.stringify(r.country || ""),
      JSON.stringify(r.source || ""),
    ].join(","));
  }

  return new Response(rows.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="atomik-subscribers-${Date.now()}.csv"`,
    },
  });
}
