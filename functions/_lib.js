/* Shared helpers for Pages Functions */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
export const RATE_WINDOW_SECS = 60 * 60;
export const RATE_MAX_HITS = 5;

export function corsHeaders(origin, env) {
  let allowed = [];
  try { allowed = JSON.parse(env.ALLOWED_ORIGINS || "[]"); } catch {}
  const allowOrigin = allowed.includes(origin) ? origin : (allowed[0] || "*");
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export async function rateLimit(env, ip) {
  if (!ip || !env.DB) return true;
  const now = Math.floor(Date.now() / 1000);
  const winStart = now - RATE_WINDOW_SECS;

  const row = await env.DB
    .prepare("SELECT count, window_start FROM rate_limits WHERE ip = ?")
    .bind(ip).first();

  if (!row || row.window_start < winStart) {
    await env.DB
      .prepare("INSERT OR REPLACE INTO rate_limits (ip, count, window_start) VALUES (?, 1, ?)")
      .bind(ip, now).run();
    return true;
  }
  if (row.count >= RATE_MAX_HITS) return false;
  await env.DB
    .prepare("UPDATE rate_limits SET count = count + 1 WHERE ip = ?")
    .bind(ip).run();
  return true;
}

export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true; // optional
  if (!token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", body: form,
  });
  const data = await r.json().catch(() => ({}));
  return data.success === true;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

export async function sendWelcomeEmail(env, toEmail) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: "no_resend_key" };

  const from = env.FROM_EMAIL || "Atomik Selections <no-reply@atomikselections.com>";
  const subject = "◉ Signal locked — welcome to Atomik Selections";
  const preheader = "Your frequency has been registered in our archives.";

  const html = renderWelcomeHTML(toEmail, preheader);
  const text = renderWelcomeText(toEmail);

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from, to: toEmail, subject, html, text,
      reply_to: "no-reply@atomikselections.com",
      headers: { "X-Entity-Ref-ID": crypto.randomUUID() },
    }),
  });

  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    return { sent: false, reason: `resend_${r.status}`, detail };
  }
  const data = await r.json().catch(() => ({}));
  return { sent: true, id: data.id };
}

function renderWelcomeHTML(email, preheader) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Signal locked — Atomik Selections</title>
</head>
<body style="margin:0;padding:0;background:#04001a;color:#f3e7ff;font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preheader)}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:
    radial-gradient(ellipse 80% 60% at 50% 12%, #16093a 0%, transparent 60%),
    radial-gradient(ellipse 70% 80% at 50% 100%, #2a0d5e 0%, transparent 55%),
    linear-gradient(180deg, #02000d 0%, #06001f 50%, #0a0228 100%);
    background-color:#04001a;">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;">
          <tr>
            <td style="padding:0 0 28px;text-align:center;">
              <div style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.32em;color:rgba(255,230,250,.55);text-transform:uppercase;">
                <span style="color:#ff7ad9;">[</span> Transmission received <span style="color:#ff7ad9;">]</span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="border:1px solid rgba(190,130,255,.22);background:rgba(10,2,40,.55);padding:40px 32px;">
              <h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:400;font-size:28px;line-height:1.2;color:#ffffff;letter-spacing:.01em;">
                Signal locked.
              </h1>
              <p style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.6;color:rgba(248,233,255,.85);">
                Thanks for tuning in. Your frequency <strong style="color:#75f0ff;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:500;">${escapeHtml(email)}</strong> has been registered in our archives.
              </p>
              <p style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.6;color:rgba(248,233,255,.85);">
                You'll hear from us the moment <em style="color:#ff7ad9;">Atomik Selections</em> goes live —
                new genetics, drops and cosmic releases, straight to your inbox.
              </p>
              <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.6;color:rgba(248,233,255,.85);">
                Until then: stay tuned, stay curious, stay 21+.
              </p>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:32px;">
                <tr>
                  <td style="border-top:1px solid rgba(190,130,255,.18);padding-top:18px;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.28em;color:rgba(190,160,230,.45);text-transform:uppercase;">
                    Mission · Atomik-01 &nbsp;·&nbsp; Status · <span style="color:#75f0ff;">Germinating</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 8px 0;text-align:center;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.3em;color:rgba(190,160,230,.4);text-transform:uppercase;">
              <a href="https://atomikselections.com" style="color:#a875ff;text-decoration:none;">atomikselections.com</a>
              &nbsp;·&nbsp; 21+ &nbsp;·&nbsp; <em style="font-style:normal;color:#ff7ad9;">cosmic cultivars</em><br><br>
              <span style="color:rgba(190,160,230,.3);">This is an automated message. Please do not reply.</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderWelcomeText(email) {
  return [
    "[ TRANSMISSION RECEIVED ]",
    "",
    "Signal locked.",
    "",
    `Thanks for tuning in. Your frequency ${email} has been registered in our archives.`,
    "",
    "You'll hear from us the moment Atomik Selections goes live —",
    "new genetics, drops and cosmic releases, straight to your inbox.",
    "",
    "Until then: stay tuned, stay curious, stay 21+.",
    "",
    "—",
    "Mission · Atomik-01 · Status · Germinating",
    "atomikselections.com",
    "",
    "This is an automated message. Please do not reply.",
  ].join("\n");
}
