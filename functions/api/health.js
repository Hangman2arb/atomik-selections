import { json } from "../_lib.js";

export async function onRequestGet() {
  return json({ ok: true, ts: Date.now() });
}
