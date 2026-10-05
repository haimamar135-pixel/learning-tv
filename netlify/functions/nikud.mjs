/* ─── נִקּוּד — הנקדן של דיקטה (צ'אט 20) ───
   מקבל משפטים בלי ניקוד ומחזיר אותם מנוקדים, אות באות אותו טקסט:
   רק סימני ניקוד נוספים. ראשי תיבות (מילה עם גרש או גרשיים) ומילה שהנקדן
   שינה בה אותיות נשארות כמו שהן. כך הסימונים וההערות של הלומד, שנשמרים
   לפי מיקום התו במשפט, נשארים במקומם גם כשהניקוד מוצג.

   הדפדפן לא פונה לדיקטה ישירות (CORS, והאפליקציה באייפון) אלא דרך כאן.
   השער: כניסה בלבד. דיקטה שירות חינמי, ולכן fn "nikud" לא נספר במכסה.

   גוף הבקשה: { texts: ["משפט", ...], genre?: "rabbinic" | "modern" | "premodern" }
   תשובה:     { texts: ["מְנֻקָּד", ...] }  (אותו סדר, אותו אורך)
   אפשר לכוון כתובת אחרת במשתנה הסביבה DICTA_URL. */

import { gate, json } from "./lib/gate.cjs";

const ENDPOINTS = [
  process.env.DICTA_URL,
  "https://nakdan-u1-0.loadbalancer.dicta.org.il/api",
  "https://nakdan-2-0.loadbalancer.dicta.org.il/api",
].filter(Boolean);
const MAX_CHARS = 6000;   // לבקשה אחת (הדפדפן שולח מנות של ~3,000)
const MARKS = /[֑-ׇֽֿׁׂׅׄ]/g;
const strip = (s) => s.replace(MARKS, "");
const ABBR = /["'״׳]/;    // ראשי תיבות וקיצורים: לא מנקדים

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

/* תשובת דיקטה מגיעה בשתי צורות (לפי גרסת השרת): מערך של {word, sep, options}
   או {data:[{str, sep, nakdan:{options:[{w}]}}]}. מחזיר רשימת [מילה מקורית, מנוקדת]. */
function readTokens(j) {
  const arr = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : null;
  if (!arr) return null;
  return arr.map((t) => {
    const word = String(t.word ?? t.str ?? "");
    const opts = t.options ?? t.nakdan?.options ?? [];
    const first = opts[0];
    const voc = typeof first === "string" ? first : Array.isArray(first) ? first[0] : first?.w;
    return [word, t.sep ? "" : String(voc || "")];
  });
}

/* מנקד טקסט אחד. התוצאה תמיד שווה למקור אחרי הסרת הניקוד, אחרת זורק שגיאה. */
async function nakdan(text, genre) {
  let lastErr = "";
  for (const url of ENDPOINTS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "nakdan", genre, data: text, addmorph: false, keepqq: false, nodageshdefmem: false, patachma: false, keepmetagim: true }),
      });
      if (!r.ok) { lastErr = `${new URL(url).host} השיב ${r.status}`; continue; }
      const tokens = readTokens(await r.json());
      if (!tokens) { lastErr = `${new URL(url).host}: תשובה במבנה לא מוכר`; continue; }
      let out = "";
      for (const [word, vocRaw] of tokens) {
        const voc = vocRaw.replace(/\|/g, ""); // דיקטה מסמנת גבול תחילית בקו אנכי
        out += voc && !ABBR.test(word) && strip(voc) === word ? voc : word;
      }
      if (strip(out) !== text) { lastErr = `${new URL(url).host}: הטקסט שחזר אינו תואם למקור`; continue; }
      return out;
    } catch (e) {
      lastErr = `${new URL(url).host}: ${e.message}`;
    }
  }
  throw new Error(lastErr || "הנקדן לא זמין");
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const event = await toEvent(req);
  if (event.httpMethod !== "POST") return toResponse(json(405, { error: { message: "Method not allowed" } }));
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return toResponse(json(400, { error: { message: "Bad request body" } })); }
  const texts = Array.isArray(body.texts) ? body.texts.map((t) => String(t || "")) : null;
  if (!texts || !texts.length) return toResponse(json(400, { error: { message: "חסר טקסט לניקוד" } }));
  if (texts.join("").length > MAX_CHARS) return toResponse(json(413, { error: { message: "יותר מדי טקסט בבקשה אחת" } }));
  const genre = ["rabbinic", "modern", "premodern"].includes(body.genre) ? body.genre : "rabbinic";

  const g = await gate(event, "nikud", 0);
  if (g.reject) return toResponse(g.reject);

  /* המשפטים נשלחים יחד (שורה לכל שורה במשפט) כדי לחסוך פניות; אם המנה נכשלת, שורה-שורה */
  const lines = [], counts = [];
  for (const t of texts) { const ls = t.split("\n"); counts.push(ls.length); lines.push(...ls); }
  const regroup = (ls) => { let k = 0; return counts.map((c) => ls.slice(k, (k += c)).join("\n")); };
  try {
    const parts = (await nakdan(lines.join("\n"), genre)).split("\n");
    if (parts.length === lines.length) return toResponse(json(200, { texts: regroup(parts) }));
  } catch { /* ממשיכים לשורה-שורה */ }
  const out = [];
  let failed = 0, lastErr = "";
  for (const t of lines) {
    if (!t.trim()) { out.push(t); continue; }
    try { out.push(await nakdan(t, genre)); }
    catch (e) { out.push(t); failed++; lastErr = e.message; }
  }
  if (failed && failed >= lines.filter((t) => t.trim()).length) return toResponse(json(502, { error: { message: "הנקדן של דיקטה לא ענה: " + lastErr } }));
  return toResponse(json(200, { texts: regroup(out) }));
};
