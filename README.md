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
| `POST` | `/api/subscribe` | Body `{email, h_orbit}` → `{status:"new"\|"already"\|"invalid"\|"blocked"\|"error", reason?, mailed?}`. Honeypot (`h_orbit`), 5 req/h per IP, optional Turnstile. On `new`: generates a unique discount code `ATK-XXXX-XXXX`, stores it, sends the welcome email (if enabled and `RESEND_API_KEY` is set) and logs it. Email failures never change the HTTP result. `mailed` is `true` when the email was sent — or, if Resend takes longer than 1.5 s, when it has been queued (`waitUntil`) so the landing gets a fast answer. |
| `GET` | `/api/health` | Liveness. |

### Admin (`/api/admin/*`, same-origin only, JSON)

All admin routes pass through `functions/api/admin/_middleware.js`. Errors are `{error:"<code>", message?}`
with a proper status. Every response carries `Cache-Control: no-store`.

| Method | Path | What |
| --- | --- | --- |
| `POST` | `/login` | `{email,password}` → `{ok, must_change, admin}` + session cookie. 10 attempts / 15 min per IP → 429. |
| `POST` | `/logout` | Clears the cookie. |
| `GET` | `/me` | `{admin:{id,email,name,must_change}, email_configured, version}` |
| `PUT` | `/password` | `{current,next}` (min 12 chars) → bumps `pass_version` (kills other sessions), clears `must_change`, re-issues cookie. |
| `GET` | `/stats` | Totals, today/7d/30d/prev7d, welcome sent/failed/pending, top countries, 60-day zero-filled series, latest 5. |
| `GET` | `/leads` | `?q=&country=&status=sent\|failed\|pending\|unsubscribed&from=&to=&sort=created_at\|email\|country&dir=&page=&per=` (≤200) |
| `PATCH` | `/leads/:id` | `{notes}` → updated row. |
| `DELETE` | `/leads/:id` | Hard delete + scrubs the address from `email_log`. Audited. |
| `POST` | `/leads/:id/resend-welcome` | Sends the welcome template again (kind `resend`). 409 if email is not configured. |
| `GET` | `/export.csv` | Same filters as `/leads`, no paging, `text/csv` attachment. |
| `GET` / `PUT` | `/settings` | Welcome/discount toggles, from/reply-to, subject, HTML + text templates, discount label/prefix. Validated; partial updates allowed. |
| `POST` | `/email/test` | `{to}` — only an admin's address or the reply-to. |
| `GET` | `/email/log` | Last 20 per page, joined with the subscriber email. |
| `GET` / `POST` | `/admins` | List / create (`{email,name}` → `{temp_password}` shown once, `must_change=1`). |
| `DELETE` | `/admins/:id` | Not yourself, not the last admin. |
| `GET` | `/audit` | Admin activity, 50 per page. |
| `GET` | `/health` | `{ok, db, email_configured, session_secret:"env"\|"db"}` |
| `GET` | `/count`, `/subscribers` | Legacy JSON count / CSV export. Now authenticated by the middleware (cookie **or** Bearer token). The old `?token=` query parameter is no longer accepted — use the `Authorization` header. |

### How auth works

1. Passwords are PBKDF2-SHA256 (12 000 iterations, 16-byte salt, 32-byte hash, base64) — deliberately light for the Functions CPU budget; `functions/_auth.js` is the single implementation, also imported by `dev/seed-admin.mjs`.
2. Login sets `atk_admin` = `base64url({sub,email,pv,iat,exp}).base64url(HMAC-SHA256)` — HttpOnly, SameSite=Lax, Path=/, Secure (Secure is skipped only for localhost/127.0.0.1), 7 days.
3. The HMAC key is `SESSION_SECRET`; if unset, a random 32-byte secret is generated once and kept in `settings.session_secret`.
4. On every admin request the middleware verifies signature + expiry, then one `SELECT` confirms the admin still exists and `pv` equals the current `pass_version` (a password change invalidates every other session). Alternatively `Authorization: Bearer <ADMIN_TOKEN>` (constant-time compare) authenticates scripts.
5. CSRF: state-changing methods must send `Content-Type: application/json` and, if an `Origin` header is present, it must match the site. `must_change=1` limits the session to `/me`, `/password`, `/logout` until the password is changed. Everything sensitive is written to `admin_audit`.

## Environment variables (Pages project → Settings → Variables and Secrets)

| Name | Required | Purpose |
| --- | --- | --- |
| `DB` (D1 binding) | yes | Bind the `atomik_subscribers` database as `DB`. |
| `SESSION_SECRET` | recommended | ≥ 32 random chars, HMAC key for session cookies. Falls back to a DB-stored secret. |
| `ADMIN_TOKEN` | optional | Machine token for scripted access (`Authorization: Bearer …`). |
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
then `npm run db:local` again.

## Deploy

Pushes to `main` deploy through `.github/workflows/deploy.yml` (`wrangler pages deploy public`; Pages
picks up `functions/` automatically). Manual: `npm run deploy`.

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
references `/assets/logo-color-1200.png` on the site.

## Landing notes

- The landing's form posts to `/api/subscribe`; the handler in `public/script.js` is the single place to update.
- `prefers-reduced-motion` is respected; the HUD clock ticks in UTC.

## License

Proprietary · © Atomik Selections
