#!/usr/bin/env node
/* Print the SQL that seeds an admin, hashed with EXACTLY the KDF the Functions
   runtime uses (functions/_auth.js is imported directly — keep it import-free).

   Usage:  node dev/seed-admin.mjs <email> <password> [name]
   Then:   npx wrangler d1 execute atomik_subscribers --remote --command "<the SQL>"
           (or paste it into the D1 console / HTTP API). Node ≥ 20 required. */

import { hashPassword, KDF } from "../functions/_auth.js";

const [email, password, name = "Admin"] = process.argv.slice(2);
if (!email || !password) {
  console.error("usage: node dev/seed-admin.mjs <email> <password> [name]");
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email)) {
  console.error("error: invalid email address");
  process.exit(1);
}

const { pass_hash, pass_salt, iterations } = await hashPassword(password);
const sql = (s) => `'${String(s).replace(/'/g, "''")}'`;

console.log(
  `INSERT INTO admins (email, name, pass_hash, pass_salt, iterations, pass_version, must_change, created_by)\n` +
  `VALUES (${sql(email.trim().toLowerCase())}, ${sql(name)}, ${sql(pass_hash)}, ${sql(pass_salt)}, ${iterations}, 1, 1, 'seed');`
);
console.error(`-- PBKDF2-${KDF.hash} · ${iterations} iterations · ${KDF.saltBytes}-byte salt · ${KDF.hashBytes}-byte hash. must_change=1 forces a password change on first login.`);
