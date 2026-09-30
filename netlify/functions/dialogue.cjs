/* ─── 🎧 שיקוף — שלב א: התסריט ───
   ערוץ 08. חומר הגלם הוא השיחה של הלומד עם הספר — ההערות שכתב, המשפטים
   שסימן במרקר, והשאלה שהוא נושא — לא הפרק עצמו.
   Claude כותב מזה תסריט לשני קולות חיצוניים: מורה ותלמידה, שמשוחחים
   על הלימוד של הלומד. הלומד הוא הצד השלישי השותק — מדברים עליו בגוף שלישי
   ("מילה בסלע, שתיקה בתרי").
   הקול עצמו מופק בשלב ב (voice.cjs). כאן רק טקסט — כדי שהלומד יקרא
   את התסריט לפני שהוא משלם על הקול.

   השער: fn="claude" (קריאה אחת מהמכסה היומית של Claude).
   קלט:  { title, question, learner, notes:[{src,text}], marks:[{text,color}], length }
   פלט:  { title, lines:[{ s:"t"|"s", t:"..." }], chars } */

const { gate, json } = require("./lib/gate.cjs");
const { stream } = require("@netlify/functions");
const { Readable } = require("stream");

/* למה זרימה (צ'אט 16): תסריט בעברית של 2,600+ תווים לוקח ל-Claude 40–60 שניות.
   חיבור "שקט" כל כך הרבה זמן נחתך בדרך (504 Inactivity Timeout) — לכן פותחים
   את התשובה מיד ושולחים רווח כל 4 שניות עד שה-JSON מוכן. JSON.parse בלקוח
   מתעלם מרווחים מובילים, ולכן App.jsx לא צריך להשתנות. */
const HEARTBEAT_MS = 4000;

/* אורך התסריט בתווים — ~550 תווים לדקת שמע ב-ElevenLabs */
const LENGTHS = {
  short:  { chars: 2600, label: "כ-5 דקות" },
  medium: { chars: 5200, label: "כ-10 דקות" },
  full:   { chars: 10500, label: "כ-20 דקות" },
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const clip = (s, n) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");

function buildPrompt({ title, question, learner, notes, marks, target }) {
  const who = learner || "הלומד";
  const material = [];
  if (question) material.push(`השאלה ש${who} נושא איתו בלימוד: «${question}»`);
  if (marks.length) {
    material.push(`משפטים ש${who} סימן במרקר (לפי סדר הופעתם בספר):\n` +
      marks.map((m, i) => `${i + 1}. «${m.text}»`).join("\n"));
  }
  if (notes.length) {
    material.push(`הערות ש${who} כתב על שורות בספר (המקור, ואז ההערה):\n` +
      notes.map((n, i) => `${i + 1}. על «${n.src}» — ${who} כתב: «${n.text}»`).join("\n"));
  }

  return `אתה כותב תסריט לשיחה קולית בין שני קולות: מורה (t) ותלמידה (s).
הנושא: הלימוד של ${who} בספר «${title}». ${who} עצמו לא משתתף בשיחה — הוא מאזין. מדברים עליו בגוף שלישי, בחום ובכבוד, כמו שני אנשים שקראו את הרשימות שלו ומשקפים לו מה הם רואים בהן.

חומר הגלם הוא אך ורק מה ש${who} השאיר בספר — לא תוכן הספר בכלל:
${material.join("\n\n")}

כללי השיחה:
- המורה והתלמידה מדברים עברית טבעית, דיבורית, קצבית. משפטים קצרים. בלי נאומים.
- כל רפליקה עד 350 תווים. הקולות מתחלפים לעתים קרובות.
- הם מצטטים את המילים של ${who} עצמו, שואלים מה עמד מאחורי סימון או הערה, מוצאים חוט שמחבר בין ההערות, ומחזירים ל${who} את הלימוד שלו כאילו במראה — "אור חוזר".
- אם יש שאלה ש${who} נושא — היא הציר: מה בהערות ובסימונים שלו נוגע בה, ומה נשאר פתוח.
- התלמידה שואלת ומתפעלת, המורה מעמיק ומחבר — אבל שניהם לומדים מ${who}, לא מלמדים אותו.
- לא להמציא הערות או ציטוטים ש${who} לא כתב. לא להוסיף ידע חיצוני על הספר מעבר למה שנחוץ להבנת ההערות.
- הסיום: משפט אחד של המורה ש${who} ייקח איתו הלאה, ואחריו שאלה פתוחה אחת של התלמידה — בלי תשובה.
- אפשר להוסיף, במשורה, תגי רגש בסוגריים מרובעים בתחילת רפליקה: [thoughtful] [warmly] [curious] [laughs] [pause]. באנגלית, בסוגריים מרובעים, לא יותר מאחד לרפליקה, לא בכל רפליקה.

אורך כולל: כ-${target} תווים (לא פחות מ-${Math.round(target * 0.8)}, לא יותר מ-${Math.round(target * 1.1)}).

החזר JSON בלבד, בלי טקסט מסביב, במבנה:
{"title":"כותרת קצרה לשיחה (עד 8 מילים)","lines":[{"s":"t","t":"..."},{"s":"s","t":"..."}]}
s הוא "t" למורה ו-"s" לתלמידה.`;
}

const core = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: { message: "Method not allowed" } });

  const g = await gate(event, "claude");
  if (g.reject) return g.reject;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: { message: "ANTHROPIC_API_KEY לא מוגדר בהגדרות האתר ב-Netlify" } });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: { message: "Bad request body" } }); }

  const title = clip(body.title, 120) || "הספר";
  const question = clip(body.question, 300);
  const learner = clip(body.learner, 40);
  const notes = (Array.isArray(body.notes) ? body.notes : [])
    .map((n) => ({ src: clip(n && n.src, 220), text: clip(n && n.text, 600) }))
    .filter((n) => n.text).slice(0, 60);
  const marks = (Array.isArray(body.marks) ? body.marks : [])
    .map((m) => ({ text: clip(m && m.text, 260), color: clip(m && m.color, 2) }))
    .filter((m) => m.text).slice(0, 80);
  if (notes.length + marks.length < 1 && !question) {
    return json(400, { error: { message: "אין עדיין מה לשקף — סמן וכתוב בספר, ואז נחזור לכאן" } });
  }
  const len = LENGTHS[body.length] || LENGTHS.short;

  const prompt = buildPrompt({ title, question, learner, notes, marks, target: len.chars });
  if (prompt.length > 30000) return json(400, { error: { message: "יותר מדי חומר לשיחה אחת — נסה ספר עם פחות הערות" } });

  /* מכאן — תשובה זורמת: סטטוס 200 נשלח מיד; שגיאה מכאן והלאה מגיעה כ-{error} בגוף. */
  const out = new Readable({ read() {} });
  const beat = setInterval(() => out.push(" "), HEARTBEAT_MS);
  out.push(" ");
  writeScript({ apiKey, prompt, len, title })
    .then((r) => { clearInterval(beat); out.push(JSON.stringify(r)); out.push(null); })
    .catch((e) => { clearInterval(beat); out.push(JSON.stringify({ error: { message: "השרת לא הצליח לפנות ל-API: " + e.message } })); out.push(null); });
  return { statusCode: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: out };
};

/* הקריאה ל-Claude — מחזירה את אובייקט התשובה (תסריט או {error}) */
async function writeScript({ apiKey, prompt, len, title }) {
  const fail = (message) => ({ error: { message } });
  {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: Math.min(8000, Math.round(len.chars * 0.9) + 600),
        system: "אתה תסריטאי של שיחות לימוד בעברית. החזר אך ורק אובייקט JSON תקין ומלא. בלי טקסט מקדים, בלי backticks. הקפד לסגור את כל הסוגריים.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const raw = await res.text();
    if (!res.ok) {
      let m = `Claude API [${res.status}]`;
      try { m += ": " + (JSON.parse(raw).error?.message || "").slice(0, 200); } catch {}
      return fail(m);
    }
    let data;
    try { data = JSON.parse(raw); } catch { return fail("תשובה לא תקינה מה-API"); }
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const a = text.indexOf("{"), z = text.lastIndexOf("}");
    if (a < 0 || z <= a) return fail("התסריט לא הגיע כ-JSON");
    let script;
    try { script = JSON.parse(text.slice(a, z + 1).replace(/```json|```/g, "")); }
    catch { return fail("התסריט נחתך באמצע — נסה אורך קצר יותר"); }

    const lines = (Array.isArray(script.lines) ? script.lines : [])
      .map((l) => ({ s: l && l.s === "s" ? "s" : "t", t: clip(l && l.t, 700) }))
      .filter((l) => l.t);
    if (lines.length < 2) return fail("התסריט יצא ריק — נסה שוב");
    const chars = lines.reduce((n, l) => n + l.t.length, 0);
    return { title: clip(script.title, 80) || `שיקוף · ${title}`, lines, chars, minutes: Math.round(chars / 550 * 10) / 10 };
  }
}

exports.handler = stream(async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const r = await core(event);
  return { ...r, headers: { ...CORS, ...(r.headers || {}) } };
});
