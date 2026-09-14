/* ─── 🎧 שיקוף — שלב ב: הקול ───
   מקבל חתיכה אחת מהתסריט (עד 2,000 תווים — הגבול של ElevenLabs Text-to-Dialogue)
   ומחזיר MP3 כ-base64. האפליקציה קוראת לכאן חתיכה-חתיכה, מדביקה את החלקים,
   שומרת את הקובץ המלא במכשיר (IndexedDB) ומעלה עותק ל-Supabase Storage (bucket "voice").

   למה חתיכה לבקשה: פונקציה סינכרונית בנטליפיי מוגבלת ל-60 שניות; חתיכה של
   2,000 תווים (≈3.5 דקות שמע) מופקת בפחות מזה. כך גם ההתקדמות נראית ללומד.

   השער: fn="voice", יחידה אחת לחתיכה. DAILY_LIMIT_VOICE (ברירת מחדל 12 ≈ 40 דקות ביום).
   המפתח: ELEVEN_API_KEY במשתני הסביבה של נטליפיי (המפתח tv3, בלי Restrict Key).
   קולות (ניתנים לשינוי ב-env): מורה ELEVEN_VOICE_T · תלמידה ELEVEN_VOICE_S.
   עברית נתמכת רק במודל eleven_v3. */

const { gate, json } = require("./lib/gate.cjs");

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

const core = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: { message: "Method not allowed" } });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: { message: "Bad request body" } }); }
  const lines = (Array.isArray(body.lines) ? body.lines : [])
    .map((l) => ({ s: l && l.s === "s" ? "s" : "t", t: typeof (l && l.t) === "string" ? l.t.trim() : "" }))
    .filter((l) => l.t);
  const chars = lines.reduce((n, l) => n + l.t.length, 0);
  if (!lines.length) return json(400, { error: { message: "אין טקסט להקראה" } });
  if (chars > MAX_CHARS) return json(400, { error: { message: `חתיכה ארוכה מדי (${chars} תווים, המקסימום ${MAX_CHARS})` } });

  /* השער אחרי בדיקת הקלט — כדי שבקשה שגויה לא תיספר במכסה */
  const g = await gate(event, "voice", 1);
  if (g.reject) return g.reject;

  const apiKey = process.env.ELEVEN_API_KEY;
  if (!apiKey) return json(500, { error: { message: "ELEVEN_API_KEY לא מוגדר בהגדרות האתר ב-Netlify" } });

  try {
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
      return json(502, { error: { message: "ElevenLabs: " + msg }, status: res.status });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return json(502, { error: { message: "ElevenLabs החזיר קובץ ריק" } });
    return json(200, { audio: buf.toString("base64"), mime: "audio/mpeg", chars, bytes: buf.length });
  } catch (e) {
    return json(502, { error: { message: "השרת לא הצליח לפנות ל-ElevenLabs: " + e.message } });
  }
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const r = await core(event);
  return { ...r, headers: { ...CORS, ...(r.headers || {}) } };
};
