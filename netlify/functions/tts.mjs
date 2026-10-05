/* ─── 🎙 קול איכותי להקראה (צ'אט 20) ───
   מקבל חתיכת טקסט אחת (עד 1,500 תווים, כבר מנוקה מניקוד וראשי תיבות) ומחזיר MP3 כ-base64
   יחד עם זמני ההתחלה של כל תו (alignment) — כך הקריוקי בדף מדויק לתו.
   האפליקציה קוראת לכאן חתיכה-חתיכה, שומרת את הקובץ והזמנים במכשיר (IndexedDB)
   ומעלה עותק ל-Supabase Storage (bucket "voice") — פרק שהופק פעם אחת מתנגן שוב בחינם.

   השער: fn="voice" (אותה מכסה יומית של השיקוף), יחידה אחת לחתיכה.
   ElevenLabs: /v1/text-to-speech/<voice>/with-timestamps. עברית: eleven_v3 (turbo/flash 2.5 לא תומכים בעברית)
   (ניתן לשנות ב-ELEVEN_TTS_MODEL). הקול: ELEVEN_TTS_VOICE (ברירת מחדל: Daniel, כמו המורה בשיקוף).
   תשובה זורמת (רווח כל 4 שניות) כמו ב-voice.mjs, כדי לא ליפול על 60 השניות של נטליפיי. */

import { gate, json } from "./lib/gate.cjs";

const HEARTBEAT_MS = 4000;
const MAX_CHARS = 1500;
const VOICE = process.env.ELEVEN_TTS_VOICE || process.env.ELEVEN_VOICE_T || "onwK4e9ZLuTAKqWW03F9";
const MODEL = process.env.ELEVEN_TTS_MODEL || "eleven_v3";
const FORMAT = process.env.ELEVEN_FORMAT || "mp3_44100_64";

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

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const event = await toEvent(req);
  if (event.httpMethod !== "POST") return toResponse(json(405, { error: { message: "Method not allowed" } }));
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return toResponse(json(400, { error: { message: "Bad request body" } })); }
  const text = String(body.text || "").trim();
  if (!text) return toResponse(json(400, { error: { message: "אין טקסט להקראה" } }));
  if (text.length > MAX_CHARS) return toResponse(json(400, { error: { message: `חתיכה ארוכה מדי (${text.length} תווים, המקסימום ${MAX_CHARS})` } }));

  const g = await gate(event, "voice", 1);
  if (g.reject) return toResponse(g.reject);
  const apiKey = process.env.ELEVEN_API_KEY;
  if (!apiKey) return toResponse(json(500, { error: { message: "ELEVEN_API_KEY לא מוגדר בהגדרות האתר ב-Netlify" } }));

  const enc = new TextEncoder();
  const out = new ReadableStream({
    start(controller) {
      const push = (s) => { try { controller.enqueue(enc.encode(s)); } catch {} };
      push(" ");
      const beat = setInterval(() => push(" "), HEARTBEAT_MS);
      const done = (obj) => { clearInterval(beat); push(JSON.stringify(obj)); try { controller.close(); } catch {} };
      speak({ apiKey, text }).then(done).catch((e) => done({ error: { message: "השרת לא הצליח לפנות ל-ElevenLabs: " + e.message } }));
    },
  });
  return new Response(out, { status: 200, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
};

async function speak({ apiKey, text }) {
  /* נטליפיי הורגת את הפונקציה ב-60 שניות בלי הודעה ("תשובה לא תקינה [200]"). עוצרים בעצמנו ב-50 ואומרים מה קרה. */
  const t0 = Date.now();
  const ac = new AbortController();
  const killer = setTimeout(() => ac.abort(), 50000);
  let res;
  try {
    res = await fetchEleven(apiKey, text, ac.signal);
  } catch (e) {
    clearTimeout(killer);
    if (e.name === "AbortError") return { error: { message: `ElevenLabs (${MODEL}) לא סיים תוך 50 שניות על ${text.length} תווים — החתיכה ארוכה מדי למודל הזה` } };
    throw e;
  }
  return finish(res, text, t0, killer);
}

function fetchEleven(apiKey, text, signal) {
  return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=${encodeURIComponent(FORMAT)}`, {
    signal,
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    /* language_code נשלח רק אם הוגדר ELEVEN_TTS_LANG — turbo/flash דוחים "he"; eleven_v3 מזהה עברית לבד */
    body: JSON.stringify({ text, model_id: MODEL, ...(process.env.ELEVEN_TTS_LANG ? { language_code: process.env.ELEVEN_TTS_LANG } : {}) }),
  });
}

async function finish(res, text, t0, killer) {
  if (!res.ok) {
    clearTimeout(killer);
    const errText = await res.text();
    let msg = errText.slice(0, 300);
    try { const j = JSON.parse(errText); msg = (j.detail && (j.detail.message || j.detail.status)) || j.message || msg; } catch {}
    return { error: { message: "ElevenLabs: " + msg }, status: res.status };
  }
  let j;
  try { j = await res.json(); } catch (e) {
    if (e.name === "AbortError") return { error: { message: `ElevenLabs (${MODEL}) התחיל לענות אבל לא סיים תוך 50 שניות (${text.length} תווים)` } };
    throw e;
  } finally { clearTimeout(killer); }
  const audio = j.audio_base64 || "";
  if (audio.length < 1000) return { error: { message: "ElevenLabs החזיר קובץ ריק" } };
  const al = j.alignment || j.normalized_alignment || {};
  const chars = Array.isArray(al.characters) ? al.characters : [];
  const starts = Array.isArray(al.character_start_times_seconds) ? al.character_start_times_seconds : [];
  /* מיישרים את הזמנים לטקסט שנשלח: אם ElevenLabs החזיר רצף תווים שונה, ממפים לפי יחס */
  let times = starts;
  const sent = chars.join("");
  if (sent !== text) {
    times = [];
    for (let k = 0; k < text.length; k++) times.push(starts[Math.min(starts.length - 1, Math.floor(k / Math.max(1, text.length) * starts.length))] || 0);
  }
  const ends = Array.isArray(al.character_end_times_seconds) ? al.character_end_times_seconds : [];
  const dur = ends.length ? ends[ends.length - 1] : (times.length ? times[times.length - 1] : 0);
  return { audio, mime: "audio/mpeg", chars: text.length, bytes: Math.floor(audio.length * 0.75), times: times.map((t) => Math.round(t * 1000) / 1000), dur, model: MODEL, ms: Date.now() - t0 };
}
