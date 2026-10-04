/* ─── 🕯 לימוד משותף — שלב ב: כרטיס כניסה לחדר הווידאו (LiveKit) ───
   הדפדפן מבקש כאן "כרטיס" (JWT) לחדר של השיעור. הכרטיס נחתם בסוד של LiveKit שיושב
   רק בנטליפיי (LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_URL) — אף פעם לא בדפדפן.
   מי שמקבל כרטיס: רק משתמש מחובר (השער), ורק לחדר של שיעור שהוא חבר בו (נבדק מול Supabase
   עם הטוקן של המשתמש עצמו — ה-RLS של sessions מחזיר שורה רק לחברים).
   בלי ספרייה: ה-JWT נחתם כאן ידנית (HS256) עם crypto של Node.

   גוף הבקשה: { session: "<uuid של השיעור>" }
   תשובה:     { url, token, room, identity, name } */

import { createHmac } from "node:crypto";
import { gate, json } from "./lib/gate.cjs";

const SUPA_URL = process.env.SUPABASE_URL || "https://hghlesijwzpfdhmlvgiv.supabase.co";
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_JsWZApJRwuzZId7iUPwUkA_EGlZfNNe";
const TTL_SEC = 6 * 3600; // הכרטיס תקף 6 שעות

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
async function toEvent(req) {
  const headers = {};
  req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  return { httpMethod: req.method, headers, body: await req.text() };
}
const toResponse = (r) => new Response(r.body, { status: r.statusCode, headers: { ...CORS, ...(r.headers || {}) } });

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
function signLiveKit({ apiKey, apiSecret, identity, name, room, ttl }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: apiKey, sub: identity, nbf: now - 10, exp: now + ttl, name,
    video: { roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true },
  };
  const h = b64url(JSON.stringify(header)), p = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", apiSecret).update(h + "." + p).digest());
  return `${h}.${p}.${sig}`;
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const event = await toEvent(req);
  if (event.httpMethod !== "POST") return toResponse(json(405, { error: { message: "Method not allowed" } }));
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return toResponse(json(400, { error: { message: "Bad request body" } })); }
  const sessionId = String(body.session || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return toResponse(json(400, { error: { message: "חסר מזהה שיעור" } }));

  /* השער: כניסה בלבד (fn "livekit" לא נספר במכסה — הדקות נספרות אצל LiveKit) */
  const g = await gate(event, "livekit", 0);
  if (g.reject) return toResponse(g.reject);

  const url = process.env.LIVEKIT_URL, apiKey = process.env.LIVEKIT_API_KEY, apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) return toResponse(json(500, { error: { message: "LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET לא מוגדרים בנטליפיי" } }));

  /* האם המשתמש חבר בשיעור? (RLS: השורה חוזרת רק למארח או לחבר) */
  const auth = event.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const r = await fetch(`${SUPA_URL}/rest/v1/sessions?select=id,code,status,host_name&id=eq.${sessionId}`, {
    headers: { apikey: SUPA_KEY, Authorization: "Bearer " + token },
  });
  const rows = r.ok ? await r.json() : [];
  const sess = rows[0];
  if (!sess) return toResponse(json(403, { error: { message: "אינך חבר בשיעור הזה (או שהוא נסגר)" } }));
  if (sess.status !== "open") return toResponse(json(410, { error: { message: "השיעור נסגר" } }));

  const name = String(body.name || g.user.email.split("@")[0] || "לומד").slice(0, 40);
  const room = "session-" + sess.code;
  const lkToken = signLiveKit({ apiKey, apiSecret, identity: g.user.id, name, room, ttl: TTL_SEC });
  return toResponse(json(200, { url, token: lkToken, room, identity: g.user.id, name }));
};
