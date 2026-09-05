/* פונקציית שרת: תמלול אודיו — מתווכת בין האפליקציה ל-Groq Whisper (עברית).
   המפתח נלקח ממשתנה הסביבה GROQ_API_KEY ולא מגיע לדפדפן.
   מקבלת נתח אודיו יחיד (WAV 16kHz מונו, base64) ומחזירה { text }. */

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: { message: "Method not allowed" } }) };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: "GROQ_API_KEY לא מוגדר בהגדרות האתר ב-Netlify (Environment variables)" } }),
    };
  }

  let audio, lang, hint;
  try {
    const parsed = JSON.parse(event.body || "{}");
    audio = parsed.audio; // נתח WAV כ-base64 (בלי קידומת data:)
    lang = parsed.lang;   // "he" כברירת מחדל
    hint = parsed.hint;   // רמז הקשר (שם הספר/נושא) — מטה את התמלול לכתיב הנכון
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: { message: "Bad request body" } }) };
  }
  if (!audio || typeof audio !== "string" || audio.length > 5800000) {
    return { statusCode: 400, body: JSON.stringify({ error: { message: "נתח אודיו חסר או גדול מדי" } }) };
  }

  try {
    const buf = Buffer.from(audio, "base64");
    const form = new FormData();
    form.append("file", new Blob([buf], { type: "audio/wav" }), "chunk.wav");
    form.append("model", "whisper-large-v3"); // המדויק ביותר לעברית
    form.append("language", typeof lang === "string" && lang.length <= 5 ? lang : "he");
    form.append("temperature", "0");
    form.append("response_format", "json");
    if (hint && typeof hint === "string" && hint.trim() && hint.length <= 400) {
      form.append("prompt", hint.trim());
    }

    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey },
      body: form,
    });
    const body = await res.text();
    if (!res.ok) {
      let msg = "שגיאת תמלול (" + res.status + ")";
      try { msg = JSON.parse(body)?.error?.message || msg; } catch {}
      return { statusCode: res.status, body: JSON.stringify({ error: { message: msg } }) };
    }
    let text = "";
    try { text = JSON.parse(body)?.text || ""; } catch {}
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    };
  } catch (e) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: { message: "השרת לא הצליח לפנות למנוע התמלול: " + e.message } }),
    };
  }
};
