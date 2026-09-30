/* ─── 🎧 שיקוף — שלב ב: הקול ───
   מקבל חתיכה אחת מהתסריט (עד 2,000 תווים — הגבול של ElevenLabs Text-to-Dialogue)
   ומחזיר MP3 כ-base64. האפליקציה קוראת לכאן חתיכה-חתיכה, מדביקה את החלקים,
   שומרת את הקובץ המלא במכשיר (IndexedDB) ומעלה עותק ל-Supabase Storage (bucket "voice").

   השער: fn="voice", יחידה אחת לחתיכה. DAILY_LIMIT_VOICE (ברירת מחדל 12 ≈ 40 דקות ביום).
   המפתח: ELEVEN_API_KEY במשתני הסביבה של נטליפיי (בלי Restrict Key).
   קולות (ניתנים לשינוי ב-env): מורה ELEVEN_VOICE_T · תלמידה ELEVEN_VOICE_S.
   עברית נתמכת רק במודל eleven_v3.

   ── למה הקובץ הזה הוא .mjs (צ'אט 16) ──
   חתיכה של 2,000 תווים לוקחת ל-ElevenLabs 20–40 שניות. בממשק הישן של נטליפיי
   (exports.handler) הבקשה נחתכת בדרך (504 Inactivity Timeout). בממשק החדש
   (export default + Response) תשובה זורמת מקבלת 60 שניות: פותחים את התשובה מיד,
   שולחים רווח כל 4 שניות, ובסוף את ה-JSON. JSON.parse בלקוח מתעלם מרווחים
   מובילים — App.jsx לא השתנה. */

import { gate, json } from "./lib/gate.cjs";

const HEARTBEAT_MS = 4000;
const MAX_CHARS = 2000;
const VOICES = {
  t: process.env.ELEVEN_VOICE_T || "onwK4e9ZLuTAKqWW03F9", // Daniel — המורה (כמו בפודקאסט)
  s: process.env.ELEVEN_VOICE_S || "EXAVITQu4vr4xnSDxMaL", // Sarah — התלמידה
};
const FORMAT = process.env.ELEVEN_FORMAT || "mp3_44100_64";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/* מתאם: Request (v2) → אובייקט event (v1) שהשער מכיר, ותשובת v1 → Response */
async function toEvent(req) {
  const headers = {};
  req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  return { httpMethod: req.method, headers, body: await req.text() };
}
const toResponse = (r) => new Response(r.body, { status: r.statusCode, headers: { ...CORS, ...(r.headers || {}) } });

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const event = await toEvent(req);
  if (event.httpMethod !== "POST") return toResponse(json(405, { error: { message: "Method not allowed" } }));

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return toResponse(json(400, { error: { message: "Bad request body" } })); }
  const lines = (Array.isArray(body.lines) ? body.lines : [])
    .map((l) => ({ s: l && l.s === "s" ? "s" : "t", t: typeof (l && l.t) === "string" ? l.t.trim() : "" }))
    .filter((l) => l.t);
  const chars = lines.reduce((n, l) => n + l.t.length, 0);
  if (!lines.length) return toResponse(json(400, { error: { message: "אין טקסט להקראה" } }));
  if (chars > MAX_CHARS) return toResponse(json(400, { error: { message: `חתיכה ארוכה מדי (${chars} תווים, המקסימום ${MAX_CHARS})` } }));

  /* השער אחרי בדיקת הקלט — כדי שבקשה שגויה לא תיספר במכסה */
  const g = await gate(event, "voice", 1);
  if (g.reject) return toResponse(g.reject);

  const apiKey = process.env.ELEVEN_API_KEY;
  if (!apiKey) return toResponse(json(500, { error: { message: "ELEVEN_API_KEY לא מוגדר בהגדרות האתר ב-Netlify" } }));

  /* מכאן — תשובה זורמת: סטטוס 200 נשלח מיד; שגיאה מכאן והלאה מגיעה כ-{error} בגוף. */
  const enc = new TextEncoder();
  const out = new ReadableStream({
    start(controller) {
      const push = (s) => { try { controller.enqueue(enc.encode(s)); } catch {} };
      push(" ");
      const beat = setInterval(() => push(" "), HEARTBEAT_MS);
      const done = (obj) => { clearInterval(beat); push(JSON.stringify(obj)); try { controller.close(); } catch {} };
      speak({ apiKey, lines, chars })
        .then(done)
        .catch((e) => done({ error: { message: "השרת לא הצליח לפנות ל-ElevenLabs: " + e.message } }));
    },
  });
  return new Response(out, { status: 200, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
};

/* הקריאה ל-ElevenLabs — מחזירה את אובייקט התשובה (שמע או {error}) */
async function speak({ apiKey, lines, chars }) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-dialogue?output_format=${encodeURIComponent(FORMAT)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey, Accept: "audio/mpeg" },
    body: JSON.stringify({
      model_id: "eleven_v3",
      language_code: "he",
      inputs: lines.map((l) => ({ text: l.t, voice_id: VOICES[l.s] })),
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    let msg = errText.slice(0, 300);
    try { const j = JSON.parse(errText); msg = (j.detail && (j.detail.message || j.detail.status)) || j.message || msg; } catch {}
    return { error: { message: "ElevenLabs: " + msg }, status: res.status };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) return { error: { message: "ElevenLabs החזיר קובץ ריק" } };
  return { audio: buf.toString("base64"), mime: "audio/mpeg", chars, bytes: buf.length };
}
