/* Auth primitives: PBKDF2 password hashing, HMAC-signed session cookies,
   constant-time comparisons.

   ZERO IMPORTS ON PURPOSE — `dev/seed-admin.mjs` imports this file under
   Node 22 so that admins seeded from the CLI use exactly the same KDF as the
   Functions runtime. Web Crypto only (works in Workers and Node ≥ 20). */

export const KDF = Object.freeze({
  name: "PBKDF2",
  hash: "SHA-256",
  iterations: 12000, // deliberately low: Pages Functions CPU budget
  saltBytes: 16,
  hashBytes: 32,
});

export const SESSION_COOKIE = "atk_admin";
export const SESSION_TTL_SECS = 7 * 24 * 60 * 60;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ---------- encoding ---------- */

export function b64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64url(bytes) {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64url(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return unb64(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

export function randomBytes(n) {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/* ---------- constant-time compares ---------- */

/** XOR-compare two byte arrays. Always walks the longer input, so the running
 *  time does not depend on where the first difference is or on the shorter
 *  length. Different lengths are still a mismatch. */
export function timingSafeEqual(a, b) {
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Compare two secrets of unknown length: hash both first so neither the
 *  length nor the content of the expected value leaks through timing. */
export async function safeEqualStrings(a, b) {
  const [ha, hb] = await Promise.all([sha256(String(a ?? "")), sha256(String(b ?? ""))]);
  return timingSafeEqual(ha, hb);
}

export async function sha256(str) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(str)));
}

/* ---------- passwords ---------- */

export async function pbkdf2(password, saltBytes, iterations = KDF.iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: KDF.hash, salt: saltBytes, iterations },
    key,
    KDF.hashBytes * 8,
  );
  return new Uint8Array(bits);
}

/** → { pass_hash, pass_salt, iterations } — column names match `admins`. */
export async function hashPassword(password, iterations = KDF.iterations) {
  const salt = randomBytes(KDF.saltBytes);
  const hash = await pbkdf2(password, salt, iterations);
  return { pass_hash: b64(hash), pass_salt: b64(salt), iterations };
}

export async function verifyPassword(password, row) {
  if (!row?.pass_hash || !row?.pass_salt) return false;
  const iterations = Number(row.iterations) || KDF.iterations;
  const expected = unb64(row.pass_hash);
  const actual = await pbkdf2(password, unb64(row.pass_salt), iterations);
  return timingSafeEqual(actual, expected);
}

/** Burn the same CPU as a real verification when the account does not exist,
 *  so login timing does not reveal which emails are admins. */
export async function fakeVerify() {
  await pbkdf2("x", randomBytes(KDF.saltBytes), KDF.iterations);
  return false;
}

export function validatePassword(pw) {
  if (typeof pw !== "string") return "password must be a string";
  if (pw.length < PASSWORD_MIN) return `password must be at least ${PASSWORD_MIN} characters`;
  if (pw.length > PASSWORD_MAX) return `password must be at most ${PASSWORD_MAX} characters`;
  return null;
}

/** Unambiguous alphabet (no 0/O/1/l/I), uniform via rejection sampling. */
export function generateTempPassword(len = 20) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const out = [];
  while (out.length < len) {
    const bytes = randomBytes(len * 2);
    for (const b of bytes) {
      if (b >= 216) continue; // 216 = 4 * 54 → no modulo bias
      out.push(alphabet[b % alphabet.length]);
      if (out.length === len) break;
    }
  }
  return out.join("");
}

/* ---------- sessions ---------- */

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** payload: { sub, email, pv } → "base64url(json).base64url(hmac)" */
export async function signSession(secret, payload, ttl = SESSION_TTL_SECS) {
  const iat = Math.floor(Date.now() / 1000);
  const body = enc.encode(JSON.stringify({ ...payload, iat, exp: iat + ttl }));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), body);
  return `${b64url(body)}.${b64url(new Uint8Array(sig))}`;
}

/** → payload or null. `crypto.subtle.verify` is constant-time. */
export async function verifySession(secret, token) {
  if (typeof token !== "string" || token.length > 2048) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  try {
    const body = unb64url(token.slice(0, dot));
    const sig = unb64url(token.slice(dot + 1));
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, body);
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(body));
    const now = Math.floor(Date.now() / 1000);
    if (!payload || typeof payload.exp !== "number" || payload.exp <= now) return null;
    if (!Number.isInteger(payload.sub) || typeof payload.pv !== "number") return null;
    return payload;
  } catch {
    return null;
  }
}

/** SESSION_SECRET env var, else a random secret persisted in `settings`
 *  (key `session_secret`) so the app works before the env var exists. */
export async function getSessionSecret(env) {
  if (env.SESSION_SECRET) return { secret: env.SESSION_SECRET, source: "env" };
  const read = () => env.DB.prepare("SELECT value FROM settings WHERE key = 'session_secret'").first("value");
  let value = await read();
  if (!value) {
    const fresh = b64url(randomBytes(32));
    // INSERT OR IGNORE + re-read: two concurrent cold starts agree on one secret.
    await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value, updated_by) VALUES ('session_secret', ?, 'system')")
      .bind(fresh).run();
    value = await read();
  }
  return { secret: value, source: "db" };
}

/* ---------- cookies ---------- */

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

export function isLocalRequest(request) {
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export function sessionCookie(token, request, maxAge = SESSION_TTL_SECS) {
  const attrs = [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (!isLocalRequest(request)) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearSessionCookie(request) {
  return sessionCookie("", request, 0);
}
