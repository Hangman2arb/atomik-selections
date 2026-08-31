/* Atomik Selections · backoffice SPA (vanilla, hash router, no deps). */
(() => {
  "use strict";

  /* ============================== utils ============================== */

  const $ = (sel, root = document) => root.querySelector(sel);
  const view = $("#view");
  // `notice` is shown once on the next login screen (e.g. after a session expiry).
  const state = { me: null, emailConfigured: false, version: "", settingsMeta: null, notice: null };
  const hasOwn = (obj, key) => Object.hasOwn(obj, key);

  /** el("div.card#id", {attrs}, ...children) — children: Node | string | array | null */
  function el(spec, attrs = {}, ...children) {
    const [tag, ...rest] = spec.split(/(?=[.#])/);
    const node = document.createElement(tag || "div");
    for (const r of rest) r[0] === "." ? node.classList.add(r.slice(1)) : (node.id = r.slice(1));
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") node.className += (node.className ? " " : "") + v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v; // only used with trusted, constant markup
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, v);
    }
    append(node, children);
    return node;
  }
  function append(node, children) {
    for (const c of children) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) append(node, c);
      else node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }
  /** Table cell with its mobile-card label. Contents are wrapped in one `.cell`
   *  so the label (`::before`) is the only thing in the first grid column. */
  function td(label, attrs = {}, ...children) {
    const { text, ...rest } = attrs;
    return el("td", { ...rest, "data-l": label }, el("span.cell", {}, text != null ? text : null, children));
  }
  const fmtDate = (s) => s ? new Date(s * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
  const fmtDay = (s) => s ? new Date(s * 1000).toLocaleDateString(undefined, { dateStyle: "medium" }) : "—";
  const fmtN = (n) => Number(n || 0).toLocaleString();
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const maskEmail = (e) => { const s = String(e || ""); const at = s.indexOf("@"); return at > 0 ? `${s[0]}***@${s.slice(at + 1)}` : s; };
  const tzName = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "local time"; } catch { return "local time"; } };

  const TOAST_MAX = 3;
  function toast(msg, kind = "ok", ms = 3200) {
    const box = $("#toasts");
    const t = el("div.toast", { class: kind === "err" ? "toast-err" : "toast-ok", text: msg });
    box.append(t);
    while (box.children.length > TOAST_MAX) box.firstElementChild.remove();
    setTimeout(() => t.remove(), ms);
  }
  const clearToasts = () => $("#toasts").replaceChildren();

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast("Copied"); }
    catch { toast("Copy failed — select and copy manually", "err"); }
  }

  function confirmDialog({ title, text, ok = "Delete" }) {
    const dlg = $("#dlg-confirm");
    $("#dlg-confirm-title").textContent = title;
    $("#dlg-confirm-text").textContent = text;
    $("#dlg-confirm-ok").textContent = ok;
    return new Promise((resolve) => {
      dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true });
      dlg.showModal();
    });
  }

  function showSecret(value) {
    const dlg = $("#dlg-secret");
    $("#dlg-secret-value").textContent = value;
    $("#dlg-secret-copy").onclick = () => copy(value);
    dlg.showModal();
  }

  /* ============================== api ============================== */

  class ApiError extends Error {
    constructor(status, body) { super(body?.message || body?.error || `HTTP ${status}`); this.status = status; this.code = body?.error || ""; this.body = body || {}; }
  }

  /** `auth:false` (login only): a 401 is just a wrong password, not a lost session. */
  async function api(path, { method = "GET", body, auth = true, signal } = {}) {
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: body === undefined ? (method === "GET" ? undefined : "{}") : JSON.stringify(body),
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && auth) { sessionLost(); throw new ApiError(401, data); }
    if (res.status === 403 && data.error === "password_change_required") {
      if (state.me) state.me.must_change = true;
      route("force-password");
      throw new ApiError(403, data);
    }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  /** The server no longer accepts our cookie: back to the login screen (keeps the requested hash). */
  function sessionLost() {
    if (!state.me) return; // boot / already on the login screen
    state.notice = { text: "Your session expired — sign in again." };
    state.me = null;
    clearToasts();
    render();
  }

  function errText(e) {
    if (e instanceof ApiError) {
      if (e.body?.fields) return Object.entries(e.body.fields).map(([k, v]) => `${k}: ${v}`).join(" · ");
      return e.message;
    }
    return e?.message || "Something went wrong";
  }
  const isAbort = (e) => e?.name === "AbortError";

  /* ============================== shell ============================== */

  /* Route handlers resolve to { root, update?, after? }: `root` is mounted by
     render(); `update(params)` refreshes the mounted view in place (dim, never
     unmount — typed text and focus survive); `after()` runs once mounted. */
  const ROUTES = {
    dashboard: renderDashboard, leads: renderLeads, email: renderEmail,
    admins: renderAdmins, activity: renderActivity, account: renderAccount,
  };
  let mounted = { name: null, root: null, update: null };
  let renderSeq = 0;
  /** Any route render still in flight must not mount over what replaces it (login screen, error). */
  const invalidateRenders = () => { renderSeq++; mounted = { name: null, root: null, update: null }; };

  function parseHash() {
    const h = location.hash.replace(/^#\/?/, "");
    const [name, qs = ""] = h.split("?");
    return { name: name || "dashboard", params: new URLSearchParams(qs) };
  }

  function route(name, params) {
    const target = `#/${name}${params ? "?" + params : ""}`;
    if (location.hash === target) render(); else location.hash = target;
  }

  function setShell(visible) {
    $("#top").hidden = !visible;
    if (visible && state.me) {
      $("#who").textContent = state.me.name || state.me.email;
      $("#who").title = state.me.email;
      $("#pill-email").hidden = state.emailConfigured;
    }
  }

  function markNav(name) {
    let active = null;
    for (const a of document.querySelectorAll("#nav a")) {
      if (a.dataset.route === name) { a.setAttribute("aria-current", "page"); active = a; }
      else a.removeAttribute("aria-current");
    }
    // The nav scrolls horizontally on phones: keep the current section in view.
    active?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
    updateNavFade();
  }

  function updateNavFade() {
    const nav = $("#nav"), wrap = nav.parentElement;
    wrap.classList.toggle("more-right", nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
    wrap.classList.toggle("more-left", nav.scrollLeft > 1);
  }

  function mount(root) {
    view.replaceChildren(root);
  }

  async function render() {
    const { name, params } = parseHash();
    if (!state.me) return renderLogin();
    if (state.me.must_change) return renderForcePassword();
    if (name === "login" || name === "force-password") return route("dashboard");
    const routeName = hasOwn(ROUTES, name) ? name : "dashboard";
    setShell(true);
    markNav(routeName);

    if (mounted.name === routeName && mounted.update && view.contains(mounted.root)) {
      try { await mounted.update(params); } catch (e) { showError(e); }
      return;
    }
    const seq = ++renderSeq;
    mounted = { name: routeName, root: null, update: null };
    mount(el("p.dim", { text: "Loading…" }));
    try {
      const r = await ROUTES[routeName](params);
      if (seq !== renderSeq || !state.me) return; // a newer navigation (or the login screen) won
      mounted = { name: routeName, root: r.root, update: r.update || null };
      mount(r.root);
      r.after?.();
    } catch (e) { if (seq === renderSeq) showError(e); }
  }

  function showError(e) {
    if (isAbort(e) || (e instanceof ApiError && (e.status === 401 || e.status === 403))) return;
    invalidateRenders();
    mount(el("div.banner.banner-err", { text: errText(e) }));
  }

  async function boot() {
    const logo = $("#brand-logo");
    logo.addEventListener("error", () => { logo.src = "/assets/logo.png"; }, { once: true });
    $("#btn-logout").addEventListener("click", logout);
    $("#nav").addEventListener("scroll", updateNavFade, { passive: true });
    window.addEventListener("resize", debounce(updateNavFade, 100));
    window.addEventListener("hashchange", render);
    try {
      await loadMe();
    } catch { state.me = null; }
    render();
  }

  async function loadMe() {
    const me = await api("/api/admin/me");
    state.me = me.admin;
    state.emailConfigured = me.email_configured;
    state.version = me.version;
  }

  async function logout() {
    try { await api("/api/admin/logout", { method: "POST" }); } catch {}
    state.me = null;
    state.notice = { text: "You have been signed out everywhere." };
    clearToasts();
    render();
  }

  /* ============================== auth screens ============================== */

  function authLogo() {
    const img = el("img.logo", { src: "/assets/logo-color-1200.webp", alt: "Atomik Selections" });
    img.addEventListener("error", () => { img.src = "/assets/logo.png"; }, { once: true });
    return img;
  }

  function renderLogin() {
    setShell(false);
    invalidateRenders();
    const notice = state.notice; state.notice = null;
    const info = notice ? el("div.banner.banner-info", { role: "status", text: notice.text }) : null;
    const err = el("div.banner.banner-err", { role: "alert", hidden: true });
    const email = el("input", { type: "email", id: "login-email", name: "email", autocomplete: "username", required: true, maxlength: "254" });
    const pw = el("input", { type: "password", id: "login-pw", name: "password", autocomplete: "current-password", required: true, maxlength: "256" });
    const btn = el("button.btn.btn-primary", { type: "submit", text: "Sign in" });
    const form = el("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        err.hidden = true; btn.disabled = true;
        try {
          const r = await api("/api/admin/login", { method: "POST", body: { email: email.value.trim(), password: pw.value }, auth: false });
          await loadMe();
          toast(`Welcome back, ${r.admin.name || r.admin.email}`);
          const wanted = parseHash();
          const known = hasOwn(ROUTES, wanted.name);
          route(r.must_change ? "force-password" : (known ? wanted.name : "dashboard"), known ? wanted.params.toString() : "");
        } catch (e2) {
          // Rendered in place: the typed email stays, only the password is cleared.
          err.textContent = e2.status === 429 ? "Too many attempts. Wait 15 minutes and try again."
            : e2 instanceof ApiError ? "Invalid email or password." : "Could not reach the server. Try again.";
          err.hidden = false; if (info) info.hidden = true;
          pw.value = ""; pw.focus();
        } finally { btn.disabled = false; }
      },
    },
      el("div.field", {}, el("label", { for: "login-email", text: "Email" }), email),
      el("div.field", {}, el("label", { for: "login-pw", text: "Password" }), pw),
      err, btn,
    );
    mount(el("div.auth", {}, el("div.card", {}, authLogo(), el("h1", { text: "Backoffice" }), el("p.lead", { text: "Sign in to manage leads and emails." }), info, form)));
    email.focus();
  }

  function passwordForm({ onDone, requireCurrent = true }) {
    const err = el("div.banner.banner-err", { role: "alert", hidden: true });
    const cur = el("input", { type: "password", id: "pw-cur", autocomplete: "current-password", required: true, maxlength: "256" });
    const next = el("input", { type: "password", id: "pw-next", autocomplete: "new-password", required: true, minlength: "12", maxlength: "256" });
    const again = el("input", { type: "password", id: "pw-again", autocomplete: "new-password", required: true, minlength: "12", maxlength: "256" });
    const btn = el("button.btn.btn-primary", { type: "submit", text: "Change password" });
    const form = el("form", {
      onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true;
        if (next.value !== again.value) { err.textContent = "The two new passwords do not match."; err.hidden = false; again.focus(); return; }
        if (next.value.length < 12) { err.textContent = "Use at least 12 characters."; err.hidden = false; next.focus(); return; }
        btn.disabled = true;
        try {
          await api("/api/admin/password", { method: "PUT", body: { current: cur.value, next: next.value } });
          cur.value = next.value = again.value = "";
          toast("Password updated");
          onDone?.();
        } catch (e2) {
          err.textContent = errText(e2); err.hidden = false;
          (e2.code === "wrong_current_password" ? cur : next).focus();
        }
        finally { btn.disabled = false; }
      },
    },
      requireCurrent && el("div.field", {}, el("label", { for: "pw-cur", text: "Current password" }), cur),
      el("div.field", {}, el("label", { for: "pw-next", text: "New password" }), next, el("span.hint", { text: "At least 12 characters. A passphrase works well." })),
      el("div.field", {}, el("label", { for: "pw-again", text: "Repeat new password" }), again),
      err, btn,
    );
    form.focusFirst = () => (requireCurrent ? cur : next).focus();
    return form;
  }

  function renderForcePassword() {
    setShell(false);
    invalidateRenders();
    const form = passwordForm({ onDone: async () => { await loadMe(); route("dashboard"); } });
    mount(el("div.auth", {}, el("div.card", {},
      authLogo(),
      el("h1", { text: "Set a new password" }),
      el("p.lead", { text: "You signed in with a temporary password. Choose your own before continuing." }),
      form,
      el("p", { style: "text-align:center;margin:14px 0 0" }, el("button.btn.btn-ghost.btn-sm", { type: "button", text: "Log out", onclick: logout })),
    )));
    form.focusFirst();
  }

  /* ============================== dashboard ============================== */

  function tile(label, value, { cls = "", delta, sub, hint } = {}) {
    return el("div.card.tile", { class: cls },
      el("div.label", { text: label }),
      el("div.value", { text: fmtN(value) }),
      delta ? el("div.delta", { class: delta.cls, text: delta.text }) : null,
      sub ? el("div.sub", { text: sub }) : null,
      hint ? el("div.hint", { text: hint }) : null,
    );
  }

  function barChart(series) {
    const W = 600, H = 160, padL = 28, padB = 18, padT = 8;
    const max = Math.max(1, ...series.map((d) => d.n));
    const iw = (W - padL) / series.length;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "chart");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Signups per day, last ${series.length} days`);
    const ns = (tag, attrs) => { const n = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
    const plotH = H - padB - padT;
    for (const frac of [0, 0.5, 1]) {
      const y = padT + plotH - plotH * frac;
      svg.append(ns("line", { x1: padL, x2: W, y1: y, y2: y, class: "axis", opacity: frac === 0 ? 1 : 0.4 }));
      const t = ns("text", { x: padL - 4, y: y + 3, "text-anchor": "end" }); t.textContent = Math.round(max * frac); svg.append(t);
    }
    series.forEach((d, i) => {
      const h = Math.round(plotH * d.n / max);
      const r = ns("rect", { x: padL + i * iw + 1, y: padT + plotH - h, width: Math.max(1, iw - 2), height: Math.max(d.n ? 2 : 0, h), rx: 1, class: "bar" });
      const title = ns("title", {}); title.textContent = `${d.day}: ${d.n}`; r.append(title);
      svg.append(r);
    });
    return svg;
  }

  const STATUS_PILLS = { sent: ["pill-ok", "sent"], failed: ["pill-bad", "failed"], skipped: ["pill-dim", "skipped"] };
  function statusPill(s) {
    const [cls, label] = hasOwn(STATUS_PILLS, s) ? STATUS_PILLS[s] : ["pill-dim", "pending"];
    return el("span.pill", { class: cls, text: label });
  }

  async function renderDashboard() {
    // Day boundaries ("Today", the chart) follow this browser's timezone (see stats.js).
    const tz = tzName();
    const s = await api(`/api/admin/stats?tz=${new Date().getTimezoneOffset()}`);
    const diff = s.last7 - s.prev7;
    const pct = s.prev7 ? Math.round((diff / s.prev7) * 100) : null;
    const delta = { cls: diff > 0 ? "up" : diff < 0 ? "down" : "", text: `${diff >= 0 ? "+" : ""}${diff}${pct != null ? ` (${pct >= 0 ? "+" : ""}${pct}%)` : ""} vs previous 7 days` };
    const maxC = Math.max(1, ...s.by_country.map((c) => c.n));
    const w = s.welcome;
    const notSent = (w.pending || 0) + (w.skipped || 0);

    const root = el("div", {},
      el("div.page-head", {}, el("h1", { text: "Dashboard" }), el("div.actions", {}, el("a.btn.btn-ghost.btn-sm", { href: "#/leads", text: "All leads" }))),
      el("div.stack", {},
        el("div.grid.grid-tiles", {},
          tile("Total leads", s.total, { cls: "accent" }),
          tile("Today", s.today, { cls: "cyan", sub: tz }),
          tile("Last 7 days", s.last7, { delta }),
          tile("Last 30 days", s.last30),
          tile("Welcome sent", w.sent),
          tile("Welcome failed", w.failed, { cls: w.failed ? "pink" : "" }),
          tile("Not sent", notSent, {
            sub: `pending ${fmtN(w.pending)} · skipped ${fmtN(w.skipped)}`,
            hint: state.emailConfigured ? null : "Email is not configured — new signups are skipped.",
          }),
        ),
        el("div.grid.grid-2", {},
          el("div.card", {}, el("h2", { text: "Signups · last 60 days" }), barChart(s.series),
            el("div.chart-foot", {}, el("span", { text: s.series[0]?.day || "" }), el("span", { text: `days in ${tz}` }), el("span", { text: s.series.at(-1)?.day || "" }))),
          el("div.card", {}, el("h2", { text: "Top countries" }),
            s.by_country.length ? el("div.bars", {}, s.by_country.map((c) => el("div.row", {},
              el("span.mono", { text: c.country }),
              el("div.track", {}, el("div.fill", { style: `width:${Math.max(3, Math.round(100 * c.n / maxC))}%` })),
              el("span.n", { text: fmtN(c.n) }),
            ))) : el("p.empty", { text: "No country data yet." })),
        ),
        el("div.card", {}, el("h2", { text: "Latest leads" }), leadsMiniTable(s.latest)),
      ),
    );
    return { root };
  }

  function leadsMiniTable(rows) {
    if (!rows.length) return el("p.empty", { text: "No leads yet." });
    return el("div.table-wrap", {}, el("table.cards", {},
      el("thead", {}, el("tr", {}, ["Email", "Joined", "Country", "Code", "Welcome"].map((h) => el("th", { text: h })))),
      el("tbody", {}, rows.map((r) => el("tr", {},
        td("Email", { class: "email", text: r.email }),
        td("Joined", { class: "nowrap", text: fmtDate(r.created_at) }),
        td("Country", { text: r.country || "—" }),
        td("Code", { class: "code" }, el("span.code-inline", { text: r.discount_code || "—" })),
        td("Welcome", {}, statusPill(r.welcome_status)),
      ))),
    ));
  }

  /* ============================== leads ============================== */

  const STATUS_OPTIONS = [["", "Any status"], ["sent", "Welcome sent"], ["failed", "Welcome failed"], ["pending", "Pending (never attempted)"], ["skipped", "Skipped (email off)"], ["unsubscribed", "Unsubscribed"]];

  function readLeadFilters(params) {
    return {
      q: params.get("q") || "", country: params.get("country") || "", status: params.get("status") || "",
      from: params.get("from") || "", to: params.get("to") || "", sort: params.get("sort") || "created_at",
      dir: params.get("dir") || "desc", page: Math.max(1, Number(params.get("page")) || 1), per: Number(params.get("per")) || 50,
    };
  }

  /** Restore focus to the control with the same data-key after `box` was rebuilt. */
  function focusKeyIn(box) {
    const a = document.activeElement;
    return box.contains(a) && a.dataset.key ? a.dataset.key : null;
  }
  function refocus(box, key) {
    if (!key) return;
    const target = box.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!target) return;
    if (!target.disabled) { target.focus(); return; }
    // e.g. "Next" on the last page: a disabled button cannot take focus, so stay in the same group.
    const alt = [...target.parentElement.querySelectorAll("[data-key]")].find((n) => !n.disabled);
    alt?.focus();
  }

  async function renderLeads(params) {
    const f = readLeadFilters(params);
    const qs = () => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(f)) if (v && !(k === "page" && v === 1) && !(k === "per" && v === 50) && !(k === "sort" && v === "created_at") && !(k === "dir" && v === "desc")) p.set(k, v); return p.toString(); };
    const go = (patch) => { Object.assign(f, patch); route("leads", qs()); };
    const filtered = () => Boolean(f.q || f.country || f.status || f.from || f.to);

    /* Toolbar: built once, never unmounted while on this screen. */
    const search = el("input", { type: "search", id: "f-q", value: f.q, placeholder: "email, code or note", maxlength: "200" });
    search.addEventListener("input", debounce(() => go({ q: search.value.trim(), page: 1 }), 350));
    const country = el("input", { type: "text", id: "f-country", value: f.country, placeholder: "e.g. ES", maxlength: "2", style: "text-transform:uppercase", autocapitalize: "characters" });
    country.addEventListener("change", () => go({ country: country.value.trim().toUpperCase(), page: 1 }));
    const status = el("select", { id: "f-status", onchange: (e) => go({ status: e.target.value, page: 1 }) },
      STATUS_OPTIONS.map(([v, t]) => el("option", { value: v, selected: v === f.status, text: t })));
    const from = el("input", { type: "date", id: "f-from", value: f.from, onchange: (e) => go({ from: e.target.value, page: 1 }) });
    const to = el("input", { type: "date", id: "f-to", value: f.to, onchange: (e) => go({ to: e.target.value, page: 1 }) });
    const controls = { q: search, country, status, from, to };
    const syncControls = () => {
      for (const [k, node] of Object.entries(controls)) {
        if (node === document.activeElement) continue; // never clobber what the user is typing
        const v = String(f[k] ?? "");
        if (node.value !== v) node.value = v;
      }
    };

    const total = el("span.muted");
    const exportLink = el("a.btn.btn-ghost.btn-sm", { href: `/api/admin/export.csv?${qs()}`, download: "", text: "Export CSV" });
    const clearBtn = el("button.btn.btn-ghost.btn-sm", { type: "button", text: "Clear filters", hidden: !filtered(), onclick: () => route("leads") });
    const list = el("div.card.list", { "aria-busy": "true" }, el("p.dim", { text: "Loading…" }));

    const sortBtn = (key, label) => {
      const active = f.sort === key;
      const dirWord = active ? (f.dir === "asc" ? "ascending" : "descending") : "none";
      return el("th", { "aria-sort": dirWord }, el("button.sort", {
        type: "button", "data-key": `sort:${key}`,
        "aria-label": `Sort by ${label}, currently ${active ? dirWord : "not sorted"}`,
        onclick: () => go({ sort: key, dir: active && f.dir === "desc" ? "asc" : "desc", page: 1 }),
      }, label, active ? (f.dir === "asc" ? " ↑" : " ↓") : ""));
    };

    let ctrl = null;
    const loadRows = async () => {
      ctrl?.abort();
      const mine = (ctrl = new AbortController());
      const key = focusKeyIn(list);
      list.classList.add("loading"); list.setAttribute("aria-busy", "true");
      let data;
      try {
        data = await api(`/api/admin/leads?${new URLSearchParams(Object.entries(f).map(([k, v]) => [k, String(v)]))}`, { signal: mine.signal });
      } catch (e) {
        if (isAbort(e) || mine !== ctrl) return; // superseded by a newer request
        list.classList.remove("loading"); list.setAttribute("aria-busy", "false");
        if (!(e instanceof ApiError && (e.status === 401 || e.status === 403))) list.replaceChildren(el("div.banner.banner-err", { text: errText(e) }));
        return;
      }
      if (mine !== ctrl) return; // a newer response is on its way
      const pages = Math.max(1, Math.ceil(data.total / data.per));
      if (data.page > pages && data.total > 0) { go({ page: pages }); return; } // out-of-range page → last page

      total.textContent = `· ${fmtN(data.total)}`;
      exportLink.href = `/api/admin/export.csv?${qs()}`;
      clearBtn.hidden = !filtered();
      list.replaceChildren(
        data.total === 0
          ? el("p.empty", { text: filtered() ? "No leads match these filters." : "No leads yet." })
          : el("div.table-wrap", {}, el("table.cards", {},
            el("thead", {}, el("tr", {},
              sortBtn("email", "Email"), sortBtn("created_at", "Joined"), sortBtn("country", "Country"),
              el("th", { text: "Code" }), el("th", { text: "Welcome" }), el("th", { text: "Notes" }), el("th", { text: "Actions" }),
            )),
            el("tbody", {}, data.rows.map((r) => leadRow(r, loadRows))),
          )),
        el("div.pager", {},
          el("span", { text: `Page ${data.page} of ${pages} · ${data.per} per page` }),
          el("div.btns", {},
            el("select", { "aria-label": "Rows per page", "data-key": "per", onchange: (e) => go({ per: Number(e.target.value), page: 1 }) }, [25, 50, 100, 200].map((n) => el("option", { value: n, selected: n === data.per, text: `${n} / page` }))),
            el("button.btn.btn-ghost.btn-sm", { type: "button", "data-key": "prev", text: "← Prev", disabled: data.page <= 1, onclick: () => go({ page: data.page - 1 }) }),
            el("button.btn.btn-ghost.btn-sm", { type: "button", "data-key": "next", text: "Next →", disabled: data.page >= pages, onclick: () => go({ page: data.page + 1 }) }),
          )),
      );
      list.classList.remove("loading"); list.setAttribute("aria-busy", "false");
      refocus(list, key);
    };

    const root = el("div", {},
      el("div.page-head", {},
        el("h1", {}, "Leads ", total),
        el("div.actions", {}, exportLink, clearBtn)),
      el("div.toolbar", {},
        el("div.field", {}, el("label", { for: "f-q", text: "Search" }), search),
        el("div.field", {}, el("label", { for: "f-country", text: "Country" }), country),
        el("div.field", {}, el("label", { for: "f-status", text: "Status" }), status),
        el("div.field", {}, el("label", { for: "f-from", text: "From" }), from),
        el("div.field", {}, el("label", { for: "f-to", text: "To" }), to),
      ),
      list,
    );
    await loadRows();
    return {
      root,
      update: (p) => { Object.assign(f, readLeadFilters(p)); syncControls(); return loadRows(); },
    };
  }

  function leadRow(r, refresh) {
    const notesCell = td("Notes");
    const notesBox = notesCell.firstElementChild;
    const showNotes = (focus = false) => {
      const v = el("span.notes-view", { role: "button", tabindex: "0", title: "Edit note", "data-key": `note:${r.id}`, text: r.notes || "" });
      const start = () => notesBox.replaceChildren(editNotes());
      v.addEventListener("click", start);
      v.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); start(); } });
      notesBox.replaceChildren(v);
      if (focus) v.focus();
    };
    const editNotes = () => {
      const input = el("input", { type: "text", value: r.notes || "", maxlength: "2000", "aria-label": `Note for ${r.email}` });
      const save = async () => {
        try {
          const updated = await api(`/api/admin/leads/${r.id}`, { method: "PATCH", body: { notes: input.value } });
          r.notes = updated.notes; toast("Note saved"); showNotes(true);
        } catch (e) { toast(errText(e), "err"); }
      };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); if (e.key === "Escape") showNotes(true); });
      const wrap = el("div.notes-edit", {}, input, el("button.btn.btn-primary.btn-sm", { type: "button", text: "Save", onclick: save }), el("button.btn.btn-ghost.btn-sm", { type: "button", text: "Cancel", onclick: () => showNotes(true) }));
      setTimeout(() => input.focus(), 0);
      return wrap;
    };
    showNotes();

    const resend = el("button.btn.btn-ghost.btn-sm", {
      type: "button", text: "Resend welcome", "data-key": `resend:${r.id}`, title: state.emailConfigured ? "Send the welcome email again" : "RESEND_API_KEY is not set",
      disabled: !state.emailConfigured || Boolean(r.unsubscribed_at),
      onclick: async () => {
        if (!(await confirmDialog({ title: "Resend welcome email?", text: `Send the current welcome template to ${r.email}.`, ok: "Send" }))) return;
        resend.disabled = true;
        try {
          const res = await api(`/api/admin/leads/${r.id}/resend-welcome`, { method: "POST" });
          toast(res.sent ? "Welcome email sent" : `Not sent: ${res.error || "unknown error"}`, res.sent ? "ok" : "err");
          refresh();
        } catch (e) { toast(errText(e), "err"); resend.disabled = false; }
      },
    });
    const del = el("button.btn.btn-danger.btn-sm", {
      type: "button", text: "Delete", "data-key": `delete:${r.id}`,
      onclick: async () => {
        const ok = await confirmDialog({
          title: "Delete lead?",
          text: `${r.email} will be permanently removed and its address scrubbed from the email log. The activity log keeps only the lead id and a masked address (lead#${r.id} ${maskEmail(r.email)}). This cannot be undone.`,
        });
        if (!ok) return;
        try { await api(`/api/admin/leads/${r.id}`, { method: "DELETE" }); toast("Lead deleted"); refresh(); }
        catch (e) { toast(errText(e), "err"); }
      },
    });

    return el("tr", {},
      td("Email", { class: "email" }, r.email, " ", el("button.btn.btn-ghost.btn-sm.btn-icon", { type: "button", title: "Copy email", "aria-label": `Copy ${r.email}`, "data-key": `copy:${r.id}`, text: "⧉", onclick: () => copy(r.email) })),
      td("Joined", { class: "nowrap", title: r.created_at ? new Date(r.created_at * 1000).toISOString() : "", text: fmtDate(r.created_at) }),
      td("Country", { text: r.country || "—" }),
      td("Code", { class: "code" }, r.discount_code ? el("button.btn.btn-ghost.btn-sm", { type: "button", title: "Copy code", "data-key": `code:${r.id}`, onclick: () => copy(r.discount_code) }, el("span.code-inline", { text: r.discount_code })) : el("span.dim", { text: "—" })),
      td("Welcome", {}, r.unsubscribed_at ? el("span.pill.pill-pink", { text: "unsubscribed" }) : statusPill(r.welcome_status), r.welcome_sent_at ? el("div.dim", { style: "font-size:12px", text: fmtDay(r.welcome_sent_at) }) : null),
      notesCell,
      td("", {}, el("div.cell-actions", {}, resend, del)),
    );
  }

  /* ============================== email ============================== */

  async function renderEmail() {
    const meta = await api("/api/admin/settings");
    state.settingsMeta = meta;
    const s = { ...meta.settings };
    const fields = {};
    const input = (key, label, attrs = {}, hint) => {
      const id = `s-${key}`;
      const node = attrs.textarea
        ? el("textarea", { id, class: attrs.class, maxlength: meta.limits?.[key], spellcheck: attrs.spellcheck ?? "false" })
        : el("input", { id, type: attrs.type || "text", maxlength: meta.limits?.[key], autocomplete: "off", ...attrs.extra });
      node.value = s[key] ?? "";
      node.addEventListener("input", () => { s[key] = node.value; schedulePreview(); });
      fields[key] = node;
      return el("div.field", { class: attrs.span ? "span-2" : "" }, el("label", { for: id, text: label }), node, hint ? el("span.hint", { text: hint }) : null);
    };
    const toggle = (key, label, hint) => {
      const cb = el("input", { type: "checkbox", id: `s-${key}` });
      cb.checked = Boolean(s[key]);
      cb.addEventListener("change", () => { s[key] = cb.checked; schedulePreview(); });
      fields[key] = cb;
      return el("div.field", {}, el("label.switch", { for: `s-${key}` }, cb, el("span.knob"), el("span", {}, el("strong", { text: label }), hint ? el("div.hint", { text: hint }) : null)));
    };

    const preview = el("iframe.preview", { title: "Email preview", sandbox: "" });
    const previewText = el("pre", { class: "mono", style: "white-space:pre-wrap;font-size:13px;color:var(--muted);margin:0;min-height:200px", hidden: true });
    const subjectPreview = el("div.muted", { style: "margin:0 0 10px;font-size:14px" });
    // Preview only: {{site_url}} → this origin so the logo resolves locally too (real sends use SITE_URL).
    const sample = () => ({ email: state.me.email, code: `${(s.discount_prefix || "ATK").toUpperCase()}-7K3F-Q9ZP`, discount: s.discount_label || "launch discount", site_url: location.origin });
    const renderTpl = (str, vars, html) => String(str || "").replace(/\{\{\s*(email|code|discount|site_url)\s*\}\}/g, (_, k) => html ? escapeHtml(vars[k] ?? "") : (vars[k] ?? ""));
    const updatePreview = () => {
      const v = sample();
      subjectPreview.replaceChildren("Subject: ", el("strong", { text: renderTpl(s.welcome_subject, v, false) }));
      preview.srcdoc = renderTpl(s.welcome_html, v, true);
      previewText.textContent = renderTpl(s.welcome_text, v, false);
    };
    const schedulePreview = debounce(updatePreview, 250);

    const tabHtml = el("button", { type: "button", role: "tab", "aria-selected": "true", text: "HTML preview" });
    const tabText = el("button", { type: "button", role: "tab", "aria-selected": "false", text: "Plain text" });
    const selectTab = (html) => { tabHtml.setAttribute("aria-selected", String(html)); tabText.setAttribute("aria-selected", String(!html)); preview.hidden = !html; previewText.hidden = html; };
    tabHtml.onclick = () => selectTab(true); tabText.onclick = () => selectTab(false);

    const saveBtn = el("button.btn.btn-primary", { type: "submit", text: "Save settings" });
    const form = el("form", {
      onsubmit: async (e) => {
        e.preventDefault(); saveBtn.disabled = true;
        try {
          const r = await api("/api/admin/settings", { method: "PUT", body: pickSettings(s) });
          Object.assign(s, r.settings); Object.assign(meta.settings, r.settings);
          toast("Settings saved");
        } catch (e2) { toast(errText(e2), "err", 6000); }
        finally { saveBtn.disabled = false; }
      },
    },
      el("div.form-grid", {},
        toggle("welcome_enabled", "Send welcome email", "Sent automatically to every new signup."),
        toggle("discount_enabled", "Generate discount codes", "One unique code per lead, e.g. ATK-7K3F-Q9ZP."),
        input("from_name", "From name"),
        input("from_email", "From email", { type: "email" }, "Must be a verified sender domain in Resend."),
        input("reply_to", "Reply-to", { type: "email" }, "Leave empty for none."),
        input("discount_label", "Discount label", {}, "Fills {{discount}} in the template. Required while codes are enabled."),
        input("discount_prefix", "Code prefix", { extra: { style: "text-transform:uppercase", pattern: "[A-Za-z0-9]{2,6}" } }, "2–6 letters/digits."),
        input("welcome_subject", "Subject", { span: true }),
        el("div.field.span-2", {}, el("span.label", { text: "Variables (click to copy)" }), el("div.vars", {}, meta.variables.map((v) => el("code", { text: v, tabindex: "0", role: "button", onclick: () => copy(v), onkeydown: (e) => { if (e.key === "Enter") copy(v); } })))),
        input("welcome_html", "HTML template", { textarea: true, class: "code", span: true }),
        input("welcome_text", "Plain-text template", { textarea: true, class: "code", span: true, spellcheck: "true" }),
      ),
      el("div.form-actions", {}, saveBtn,
        el("button.btn.btn-ghost", { type: "button", text: "Reset to defaults", onclick: () => {
          Object.assign(s, meta.defaults);
          for (const [k, node] of Object.entries(fields)) { if (node.type === "checkbox") node.checked = Boolean(s[k]); else node.value = s[k] ?? ""; }
          updatePreview(); toast("Defaults loaded — press Save to keep them");
        } }),
        el("button.btn.btn-accent", { type: "button", text: "Send test to me", disabled: !state.emailConfigured, title: state.emailConfigured ? `Sends the SAVED template to ${state.me.email}` : "RESEND_API_KEY is not set",
          onclick: async (e) => {
            e.target.disabled = true;
            try { const r = await api("/api/admin/email/test", { method: "POST", body: { to: state.me.email } }); toast(r.sent ? `Test sent to ${state.me.email}` : `Not sent: ${r.error || "unknown error"}`, r.sent ? "ok" : "err", 6000); loadLog(); }
            catch (e2) { toast(errText(e2), "err", 6000); }
            finally { e.target.disabled = false; }
          } }),
        el("span.hint", { text: "Test uses the last saved version." }),
      ),
    );

    const logBox = el("div", {}, el("p.dim", { text: "Loading…" }));
    const loadLog = async () => {
      logBox.classList.add("loading");
      try {
        const log = await api("/api/admin/email/log");
        logBox.replaceChildren(log.rows.length ? el("div.table-wrap", {}, el("table.cards", {},
          el("thead", {}, el("tr", {}, ["When", "To", "Kind", "Status", "Detail"].map((h) => el("th", { text: h })))),
          el("tbody", {}, log.rows.map((r) => el("tr", {},
            td("When", { class: "nowrap", text: fmtDate(r.created_at) }),
            td("To", { class: "email", text: r.to_email }),
            td("Kind", {}, el("span.pill.pill-cyan", { text: r.kind })),
            td("Status", {}, statusPill(r.status)),
            td("Detail", { class: "dim", style: "font-size:12px;word-break:break-word", text: r.error || r.provider_id || "" }),
          ))),
        )) : el("p.empty", { text: "No emails logged yet." }));
      } catch (e) { if (!isAbort(e)) logBox.replaceChildren(el("div.banner.banner-err", { text: errText(e) })); }
      finally { logBox.classList.remove("loading"); }
    };

    const root = el("div", {},
      el("div.page-head", {}, el("h1", { text: "Email" })),
      el("div.stack", {},
        !state.emailConfigured ? el("div.banner.banner-warn", { text: "RESEND_API_KEY is not set on this deployment — welcome emails are logged as “skipped” and nothing is sent. Settings can still be edited." }) : null,
        el("div.grid.grid-2", {},
          el("div.card", {}, el("h2", { text: "Welcome email settings" }), form),
          el("div.card", {}, el("h2", { text: "Live preview" }), subjectPreview, el("div.tabs", { role: "tablist" }, tabHtml, tabText), preview, previewText),
        ),
        el("div.card", {}, el("h2", { text: "Recent emails" }), logBox),
      ),
    );
    updatePreview();
    loadLog();
    return { root };
  }

  function pickSettings(s) {
    const out = {};
    for (const k of ["welcome_enabled", "welcome_subject", "welcome_html", "welcome_text", "from_name", "from_email", "reply_to", "discount_enabled", "discount_label", "discount_prefix"]) out[k] = s[k];
    return out;
  }

  /* ============================== admins ============================== */

  async function renderAdmins() {
    const email = el("input", { type: "email", id: "a-email", required: true, maxlength: "254", autocomplete: "off", placeholder: "person@example.com" });
    const name = el("input", { type: "text", id: "a-name", required: true, maxlength: "100", autocomplete: "off", placeholder: "Name" });
    const btn = el("button.btn.btn-primary", { type: "submit", text: "Add admin" });
    const listCard = el("div.card", {}, el("h2", { text: "Accounts" }));
    const listBox = el("div.table-wrap");
    listCard.append(listBox);

    const renderRows = (rows) => {
      listBox.replaceChildren(el("table.cards", {},
        el("thead", {}, el("tr", {}, ["Email", "Name", "Created", "Last login", "Status", ""].map((h) => el("th", { text: h })))),
        el("tbody", {}, rows.map((a) => el("tr", {},
          td("Email", { class: "email", text: a.email }),
          td("Name", { text: a.name || "—" }),
          td("Created", { class: "nowrap", text: fmtDay(a.created_at) }),
          td("Last login", { class: "nowrap", text: fmtDate(a.last_login_at) }),
          td("Status", {}, a.must_change ? el("span.pill.pill-warn", { text: "temp password" }) : el("span.pill.pill-ok", { text: "active" }), a.id === state.me.id ? el("span.pill.pill-dim", { style: "margin-left:6px", text: "you" }) : null),
          td("", {}, a.id !== state.me.id && rows.length > 1 ? el("button.btn.btn-danger.btn-sm", { type: "button", text: "Delete", "aria-label": `Delete ${a.email}`, onclick: async () => {
            if (!(await confirmDialog({ title: "Delete admin?", text: `${a.email} will lose access immediately.` }))) return;
            try { await api(`/api/admin/admins/${a.id}`, { method: "DELETE" }); toast("Admin deleted"); await loadAdmins(); } catch (e) { toast(errText(e), "err"); }
          } }) : null),
        ))),
      ));
    };
    const loadAdmins = async () => {
      listCard.classList.add("loading");
      try { renderRows(await api("/api/admin/admins")); }
      catch (e) { if (!isAbort(e)) listBox.replaceChildren(el("div.banner.banner-err", { text: errText(e) })); }
      finally { listCard.classList.remove("loading"); }
    };

    const form = el("form.form-grid", {
      onsubmit: async (e) => {
        e.preventDefault(); btn.disabled = true;
        try {
          const r = await api("/api/admin/admins", { method: "POST", body: { email: email.value.trim(), name: name.value.trim() } });
          email.value = ""; name.value = "";
          showSecret(r.temp_password);
          $("#dlg-secret").addEventListener("close", () => email.focus(), { once: true });
          await loadAdmins();
        } catch (e2) { toast(errText(e2), "err"); }
        finally { btn.disabled = false; }
      },
    },
      el("div.field", {}, el("label", { for: "a-email", text: "Email" }), email),
      el("div.field", {}, el("label", { for: "a-name", text: "Name" }), name),
      el("div.span-2", {}, btn, " ", el("span.hint", { text: "A temporary password is generated and shown once; they must change it on first login." })),
    );

    renderRows(await api("/api/admin/admins"));
    const root = el("div", {},
      el("div.page-head", {}, el("h1", { text: "Admins" })),
      el("div.stack", {}, listCard, el("div.card", {}, el("h2", { text: "Add admin" }), form)),
    );
    return { root, update: loadAdmins };
  }

  /* ============================== account ============================== */

  async function renderAccount() {
    let health = null;
    try { health = await api("/api/admin/health"); } catch (e) { if (e instanceof ApiError && e.status === 401) throw e; }
    const root = el("div", {},
      el("div.page-head", {}, el("h1", { text: "Account" })),
      el("div.grid.grid-2", {},
        el("div.card", {}, el("h2", { text: "Change password" }), passwordForm({ onDone: () => {} })),
        el("div.card", {}, el("h2", { text: "Session & system" }), el("dl.kv", {},
          el("dt", { text: "Signed in as" }), el("dd", { text: state.me.email }),
          el("dt", { text: "Name" }), el("dd", { text: state.me.name || "—" }),
          el("dt", { text: "Build" }), el("dd.mono", { text: state.version || "—" }),
          el("dt", { text: "Database" }), el("dd", {}, health ? el("span.pill", { class: health.db ? "pill-ok" : "pill-bad", text: health.db ? "ok" : "down" }) : "—"),
          el("dt", { text: "Email (Resend)" }), el("dd", {}, el("span.pill", { class: state.emailConfigured ? "pill-ok" : "pill-warn", text: state.emailConfigured ? "configured" : "not configured" })),
          el("dt", { text: "Session secret" }), el("dd", { text: health ? (health.session_secret === "env" ? "SESSION_SECRET env var" : "generated, stored in DB") : "—" }),
        ),
          el("p.hint", { style: "margin:14px 0 0", text: "Log out signs you out everywhere: every session of your account is invalidated, not just this browser." })),
      ),
    );
    return { root };
  }

  /* ============================== activity ============================== */

  async function renderActivity(params) {
    const card = el("div.card", { "aria-busy": "true" }, el("p.dim", { text: "Loading…" }));
    const total = el("span.muted");
    let ctrl = null;
    const load = async (p) => {
      const page = Math.max(1, Number(p.get("page")) || 1);
      ctrl?.abort();
      const mine = (ctrl = new AbortController());
      const key = focusKeyIn(card);
      card.classList.add("loading"); card.setAttribute("aria-busy", "true");
      let data;
      try { data = await api(`/api/admin/audit?page=${page}`, { signal: mine.signal }); }
      catch (e) {
        if (isAbort(e) || mine !== ctrl) return;
        card.classList.remove("loading"); card.setAttribute("aria-busy", "false");
        if (!(e instanceof ApiError && (e.status === 401 || e.status === 403))) card.replaceChildren(el("div.banner.banner-err", { text: errText(e) }));
        return;
      }
      if (mine !== ctrl) return;
      const pages = Math.max(1, Math.ceil(data.total / data.per));
      if (data.page > pages && data.total > 0) { route("activity", `page=${pages}`); return; }
      total.textContent = `· ${fmtN(data.total)}`;
      card.replaceChildren(
        data.total === 0 ? el("p.empty", { text: "No activity yet." }) : el("div.table-wrap", {}, el("table.cards", {},
          el("thead", {}, el("tr", {}, ["When", "Admin", "Action", "Target", "IP"].map((h) => el("th", { text: h })))),
          el("tbody", {}, data.rows.map((r) => el("tr", {},
            td("When", { class: "nowrap", text: fmtDate(r.created_at) }),
            td("Admin", { text: r.admin_email || "—" }),
            td("Action", {}, el("span.pill", { class: /fail|delete/.test(r.action) ? "pill-pink" : "pill-cyan", text: r.action })),
            td("Target", { style: "word-break:break-word", text: r.target || "—" }),
            td("IP", { class: "mono dim", text: r.ip || "—" }),
          ))),
        )),
        el("div.pager", {}, el("span", { text: `Page ${data.page} of ${pages}` }), el("div.btns", {},
          el("button.btn.btn-ghost.btn-sm", { type: "button", "data-key": "prev", text: "← Prev", disabled: data.page <= 1, onclick: () => route("activity", `page=${data.page - 1}`) }),
          el("button.btn.btn-ghost.btn-sm", { type: "button", "data-key": "next", text: "Next →", disabled: data.page >= pages, onclick: () => route("activity", `page=${data.page + 1}`) }),
        )),
      );
      card.classList.remove("loading"); card.setAttribute("aria-busy", "false");
      refocus(card, key);
    };
    await load(params);
    const root = el("div", {},
      el("div.page-head", {}, el("h1", {}, "Activity ", total)),
      card,
    );
    return { root, update: load };
  }

  boot();
})();
