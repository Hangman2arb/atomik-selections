# ATOMIK SELECTIONS · Coming Soon + Backoffice

Cosmic coming-soon landing for **Atomik Selections** plus a small, hidden
backoffice for the email list: leads, discount codes, welcome emails and admins.

## Stack

- **Static landing** in `public/` — plain HTML + CSS + vanilla JS, no build step.
- **Cloudflare Pages Functions** in `functions/` — the API (`/api/*`), ES modules, no dependencies.
- **Cloudflare D1** (binding `DB`) — subscribers, admins, settings, email log, audit log, rate limits.
- **Resend** — transactional email (welcome email with a personal discount code).
- **Backoffice SPA** in `public/admin/` — vanilla JS hash router, no dependencies, works at 360 px.

```
.
├── public/                      # deployed as-is by Pages
│   ├── index.html · styles.css · script.js · assets/   # landing (owned by the landing track)
│   ├── admin/                   # backoffice SPA: index.html, admin.css, admin.js
│   ├── _headers                 # noindex/no-store for /admin/* and /api/*
│   └── robots.txt               # Disallow /admin/ and /api/
├── functions/
│   ├── _lib.js                  # json/fail helpers, readJson (CSRF guard), rateLimit, CSV, audit
│   ├── _auth.js                 # PBKDF2 hashing, HMAC sessions, cookies (zero imports → shared with dev/seed-admin.mjs)
│   ├── _email.js                # settings (DB over defaults), template rendering, Resend, email_log, discount codes
│   ├── _leads.js                # filter/sort query builder shared by /leads and /export.csv
│   └── api/
│       ├── health.js            # GET /api/health (public)
│       ├── subscribe.js         # POST /api/subscribe (public, CORS, honeypot, rate limit, Turnstile)
│       └── admin/               # everything here goes through _middleware.js
│           ├── _middleware.js   # auth, must_change gate, CSRF guards, no-store, generic 500s
│           ├── login.js · logout.js · me.js · password.js
│           ├── stats.js · leads/index.js · leads/[id].js · leads/[id]/resend-welcome.js · export.csv.js
│           ├── settings.js · email/test.js · email/log.js
│           ├── admins/index.js · admins/[id].js · audit.js · health.js
│           └── count.js · subscribers.js   # legacy endpoints, still working
├── migrations/
│   ├── 0000_base.sql            # pre-existing prod tables (local dev only)
│   └── 0001_backoffice.sql      # additive: new columns + admins/settings/email_log/admin_audit
├── dev/
│   ├── wrangler.dev.toml        # local-only D1 config so `d1 execute --local` and `pages dev` share one DB
│   └── seed-admin.mjs           # prints the INSERT for a new admin (same KDF as the runtime)
└── package.json                 # dev scripts (wrangler is the only devDependency)
```

## How the API is organised

### Public

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/subscribe` | Body `{email, h_orbit}` → `{status:"new"\|"already"\|"invalid"\|"blocked"\|"error", reason?, mailed?}`. Honeypot (`h_orbit`), 5 req/h per IP, optional Turnstile. On `new`: generates a unique discount code `ATK-XXXX-XXXX`, stores it, sends the welcome email (if enabled and `RESEND_API_KEY` is set) and logs it. Email failures never change the HTTP result. `mailed` is `true` only when Resend has actually accepted the message; if Resend has not answered within 1.5 s the send continues in the background (`waitUntil`) and the response is `{status:"new", mailed:false, queued:true}`. |
| `GET` | `/api/health` | Liveness. |

### Admin (`/api/admin/*`, same-origin only, JSON)

All admin routes pass through `functions/api/admin/_middleware.js`. Errors are `{error:"<code>", message?}`
with a proper status. Every response carries `Cache-Control: no-store`.

| Method | Path | What |
| --- | --- | --- |
| `POST` | `/login` | `{email,password}` → `{ok, must_change, admin}` + session cookie. Only **failed** logins count: 10 / 15 min per IP **and** 10 / 15 min per account → 429. |
| `POST` | `/logout` | "Sign out everywhere": clears the cookie **and** bumps `pass_version`, so every other session of that admin dies too. |
| `GET` | `/me` | `{admin:{id,email,name,must_change}, email_configured, version}` |
| `PUT` | `/password` | `{current,next}` (min 12 chars) → bumps `pass_version` (kills other sessions), clears `must_change`, re-issues cookie. Wrong current password → 403 `wrong_current_password`; 5 attempts / 15 min per admin → 429. |
| `GET` | `/stats` | `?tz=<minutes>` (the browser's `getTimezoneOffset()`, default 0). Totals, today/7d/30d/prev7d, `welcome:{sent,failed,pending,skipped}` (`pending` = never attempted, `skipped` = welcome off / no `RESEND_API_KEY`), top countries, 60-day zero-filled series, latest 5. "Today" and the series use day boundaries in the given offset (`date(created_at - tz*60,'unixepoch')`); it is the *current* offset, so a 60-day window spanning a DST switch is bucketed an hour off for the days before the switch. |
| `GET` | `/leads` | `?q=&country=&status=sent\|failed\|pending\|skipped\|unsubscribed&from=&to=&sort=created_at\|email\|country&dir=&page=&per=` (≤200). `q` matches email, discount code and notes (case-insensitive substring). Unknown `sort`/`status` values fall back to the default. |
| `PATCH` | `/leads/:id` | `{notes}` → updated row. |
| `DELETE` | `/leads/:id` | Hard delete + scrubs the address from `email_log` and from any older audit rows. Audit targets for lead actions are `lead#<id> j***@domain` (never the full address). |
| `POST` | `/leads/:id/resend-welcome` | Sends the welcome template again (kind `resend`). 409 if email is not configured. Success → `welcome_status='sent'`; failure → `'failed'` unless the lead already had `'sent'`. Resend calls time out after 10 s (`exception: timeout`). |
| `GET` | `/export.csv` | Same filters as `/leads`, no paging, `text/csv` attachment. |
| `GET` / `PUT` | `/settings` | Welcome/discount toggles, from/reply-to, subject, HTML + text templates, discount label/prefix. Validated; partial updates allowed. |
| `POST` | `/email/test` | `{to}` — only an admin's address or the reply-to. 10 / 15 min per admin. |
| `GET` | `/email/log` | Last 20 per page, joined with the subscriber email. |
| `GET` / `POST` | `/admins` | List / create (`{email,name}` → `{temp_password}` shown once, `must_change=1`). Creation: 10 / 15 min per admin. |
| `DELETE` | `/admins/:id` | Not yourself, not the last admin (the guard is atomic: `DELETE … WHERE (SELECT COUNT(*) FROM admins) > 1`). |
| `GET` | `/audit` | Admin activity, 50 per page. |
| `GET` | `/health` | `{ok, db, email_configured, session_secret:"env"\|"db"}` |
| `GET` | `/count`, `/subscribers` | Legacy JSON count / CSV export. Now authenticated by the middleware (cookie **or** Bearer token). The old `?token=` query parameter is no longer accepted — use the `Authorization` header. The CSV is now RFC 4180 (CRLF line endings, cells quoted when they contain `"`, `,` or newlines, formula-looking cells prefixed with `'`). |

### How auth works

1. Passwords are PBKDF2-SHA256 (12 000 iterations, 16-byte salt, 32-byte hash, base64) — deliberately light for the Functions CPU budget; `functions/_auth.js` is the single implementation, also imported by `dev/seed-admin.mjs`.
2. Login sets `__Host-atk_admin` = `base64url({sub,email,pv,iat,exp}).base64url(HMAC-SHA256)` — HttpOnly, SameSite=Lax, Path=/, Secure, 7 days. The `__Host-` prefix is browser-enforced (Secure + Path=/ + no Domain), so a sibling subdomain cannot plant a session cookie; on plain-http localhost the cookie is called `atk_admin` instead (the middleware reads both).
3. The HMAC key is `SESSION_SECRET`; if unset, a random 32-byte secret is generated once and kept in `settings.session_secret`.
4. On every admin request the middleware verifies signature + expiry, then one `SELECT` confirms the admin still exists and `pv` equals the current `pass_version` (a password change — or a logout — invalidates every other session). Alternatively `Authorization: Bearer <ADMIN_TOKEN>` (constant-time compare) authenticates scripts, **read-only**: only `GET` is accepted with a token (any mutating method → 403 `token_scope`, decided before the token is even compared), and 10 failed token attempts / 15 min per IP → 429.
5. CSRF: state-changing methods must send `Content-Type: application/json` and, if an `Origin` header is present, it must match the site. `must_change=1` limits the session to `/me`, `/password`, `/logout` until the password is changed. Everything sensitive is written to `admin_audit`.

## Environment variables (Pages project → Settings → Variables and Secrets)

| Name | Required | Purpose |
| --- | --- | --- |
| `DB` (D1 binding) | yes | Bind the `atomik_subscribers` database as `DB`. |
| `SESSION_SECRET` | recommended | ≥ 32 random chars, HMAC key for session cookies. Falls back to a DB-stored secret. |
| `ADMIN_TOKEN` | optional | **Read-only** machine token for scripted access (`Authorization: Bearer …`, `GET` only — `/count`, `/subscribers`, `/export.csv`, `/leads`, `/stats`…). Must be at least 32 random bytes, e.g. `openssl rand -base64 32`. |
| `RESEND_API_KEY` | for email | Without it nothing is sent; welcome status is `skipped` and the admin UI shows an "email not configured" pill. |
| `FROM_EMAIL` | optional | Default from-address (overridable in the admin Email screen). |
| `SITE_URL` | optional | Base URL used for `{{site_url}}` in emails (default `https://atomikselections.com`). |
| `ALLOWED_ORIGINS` | optional | JSON array of origins allowed to call `/api/subscribe` cross-site. |
| `TURNSTILE_SECRET` | optional | Enables Cloudflare Turnstile verification on subscribe. |

## Local development

Requires Node 22 (`source ~/.nvm/nvm.sh && nvm use 22`).

```bash
npm install                 # installs wrangler (devDependency)
npm run db:local            # applies migrations/0000 + 0001 to the local D1 in .wrangler/state
npm run seed:admin -- you@example.com 'a-temporary-password' "Your Name"
#   → prints an INSERT statement; run it locally with:
npm run db:local:sql -- "<paste the INSERT here>"
npm run dev                 # http://127.0.0.1:8788  (landing)  ·  http://127.0.0.1:8788/admin/  (backoffice)
```

`npm run dev` binds `SESSION_SECRET=devsecret`, `ADMIN_TOKEN=devtoken` and no `RESEND_API_KEY`, so
emails are logged as `skipped`. To test real sending add `--binding RESEND_API_KEY=re_…` (or use a
`.dev.vars` file, which is gitignored). `dev/wrangler.dev.toml` exists only so that `wrangler d1
execute --local` and `wrangler pages dev --d1 DB=<id>` write to the same SQLite file.

The first login with a seeded admin forces a password change (`must_change=1`).

`db:local` is not idempotent (0001 uses `ALTER TABLE`): to reset local data run `rm -rf .wrangler/state` and
then `npm run db:local` again. Rate limits live in the same DB (`rate_limits`), so after hammering login /
token tests locally either wait 15 minutes or `npm run db:local:sql -- "DELETE FROM rate_limits"`.

## Deploy

Pushes to `main` deploy through `.github/workflows/deploy.yml` (`wrangler pages deploy public`; Pages
picks up `functions/` automatically). Manual: `npm run deploy`.

### Deploy checklist

CI deploys **automatically** on every push to `main`, so the database must be ready *before* the merge:

1. **Apply migrations to production first**: `npm run db:migrate:prod` (production already has `0001_backoffice.sql`;
   any future `migrations/000N_*.sql` must be applied the same way before the code that needs it lands on `main`).
   Migrations are additive, so applying them while the old code is still running is safe — the reverse (new code,
   old schema) is not: every `/api/admin/*` call and the discount-code insert would fail.
2. Check the Pages variables (`SESSION_SECRET`, `RESEND_API_KEY`, `ADMIN_TOKEN` if used) are set.
3. Merge to `main`, watch the workflow, then hit `/api/admin/health` (with a token or after logging in) — `db:true`
   and `email_configured:true` are expected.

One-time production setup:

1. Apply the additive migration to the live DB (safe while the old code is running):
   `npm run db:migrate:prod` (= `wrangler d1 execute atomik_subscribers --remote --file migrations/0001_backoffice.sql`).
2. Set the variables above in the Pages project (at least `SESSION_SECRET` and `RESEND_API_KEY`).
3. Seed the first admin (below). Further admins are created from the Admins screen.

### Seeding an admin in production

```bash
node dev/seed-admin.mjs owner@atomikselections.com 'Some-Temporary-Pass-123' "Owner"
# copy the printed INSERT, then:
npx wrangler d1 execute atomik_subscribers --remote --command "INSERT INTO admins (...) VALUES (...);"
```

The script hashes with exactly the runtime KDF, so the printed row is valid as-is. The admin is created
with `must_change=1` and has to pick a new password on first login. Pick a throwaway temporary password:
it is visible in your shell history.

## Backoffice (`/admin/`)

Hidden (not linked, `noindex`, disallowed in `robots.txt`). Screens: Dashboard (stats, 60-day chart,
top countries, latest leads) · Leads (search, filters, sort, paging, copy email/code, inline notes,
resend welcome, delete, CSV export) · Email (toggles, sender, subject, HTML/text templates with live
preview, send test, recent log) · Admins · Account (change password, system status) · Activity (audit log).

Template variables: `{{email}}`, `{{code}}`, `{{discount}}`, `{{site_url}}`. The default template
references `/assets/logo-color-1200.png` on the site. In the admin's live preview `{{site_url}}` is
replaced by the current origin so the logo renders locally too; real sends use `SITE_URL`.

`/admin/*` is served with a strict `Content-Security-Policy` (`public/_headers`): scripts only from the
site, no inline scripts, `connect-src 'self'`, `frame-ancestors 'none'`. The preview iframe (`srcdoc`,
sandboxed) inherits that policy, which is why inline styles and the Google Fonts hosts are allowed.

## Landing notes

- The landing's form posts to `/api/subscribe`; the handler in `public/script.js` is the single place to update.
- `prefers-reduced-motion` is respected; the HUD clock ticks in UTC.

## License

Proprietary · © Atomik Selections
